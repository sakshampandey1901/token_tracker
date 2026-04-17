-- Token Tracker — initial schema
-- Conventions: RLS enabled on every table, policies restrict to owner only.
-- Service-role (used by Edge Functions and ingest API) bypasses RLS by default.

set search_path = public;

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------------
create type tier_plan as enum ('free', 'pro', 'team', 'enterprise');
create type llm_provider as enum ('openai', 'anthropic', 'google', 'mistral', 'cursor', 'custom');

-- ------------------------------------------------------------------
-- profiles: mirrors auth.users, stores tier + preferences
-- ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  tier tier_plan not null default 'free',
  -- Token budget for the tier (per-24h rolling window). Kept per-row so self-hosters can customize.
  daily_token_limit bigint not null default 100000,
  monthly_token_limit bigint not null default 2000000,
  -- A per-user shared secret used by the extension to authenticate ingest requests.
  -- Rotatable, never exposed to the browser client via RLS.
  ingest_token text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner select" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: owner update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Insertion happens via a trigger when a new auth user is created (see end of file).

-- ------------------------------------------------------------------
-- usage_events: append-only log of every token-producing call
-- ------------------------------------------------------------------
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider llm_provider not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  total_tokens integer generated always as (input_tokens + output_tokens + cached_tokens) stored,
  cost_usd numeric(12, 6) not null default 0,
  source text not null default 'extension',  -- 'extension' | 'api' | 'manual'
  occurred_at timestamptz not null default now(),
  -- idempotency: per-user unique id supplied by the extension
  client_event_id text,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index usage_events_user_time_idx
  on public.usage_events (user_id, occurred_at desc);

create index usage_events_user_provider_time_idx
  on public.usage_events (user_id, provider, occurred_at desc);

alter table public.usage_events enable row level security;

create policy "usage_events: owner select" on public.usage_events
  for select using (auth.uid() = user_id);

create policy "usage_events: owner insert" on public.usage_events
  for insert with check (auth.uid() = user_id);

-- No UPDATE / DELETE policies — events are immutable to the owner.
-- Service role bypasses RLS for ingest + aggregation.

-- ------------------------------------------------------------------
-- weekly_rollups: materialized per-day totals, one row per (user, day)
-- ------------------------------------------------------------------
create table public.daily_rollups (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  total_tokens bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.daily_rollups enable row level security;

create policy "daily_rollups: owner select" on public.daily_rollups
  for select using (auth.uid() = user_id);
-- Writes happen via service role from the Edge Function / trigger.

-- ------------------------------------------------------------------
-- Trigger: keep daily_rollups in sync when usage_events are inserted
-- ------------------------------------------------------------------
create or replace function public.tt_bump_daily_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_rollups as d
    (user_id, day, total_tokens, input_tokens, output_tokens, cached_tokens, cost_usd, updated_at)
  values
    (new.user_id, (new.occurred_at at time zone 'UTC')::date,
     new.total_tokens, new.input_tokens, new.output_tokens, new.cached_tokens, new.cost_usd, now())
  on conflict (user_id, day) do update
    set total_tokens  = d.total_tokens  + excluded.total_tokens,
        input_tokens  = d.input_tokens  + excluded.input_tokens,
        output_tokens = d.output_tokens + excluded.output_tokens,
        cached_tokens = d.cached_tokens + excluded.cached_tokens,
        cost_usd      = d.cost_usd      + excluded.cost_usd,
        updated_at    = now();
  return new;
end;
$$;

-- Keep the function in the private (default) search path; only trigger invocation exposes it.
revoke all on function public.tt_bump_daily_rollup() from public, anon, authenticated;

create trigger usage_events_bump_daily
  after insert on public.usage_events
  for each row execute function public.tt_bump_daily_rollup();

-- ------------------------------------------------------------------
-- View: live 24h window + this-week / last-week comparisons
-- Uses security_invoker so RLS on the underlying tables is enforced.
-- ------------------------------------------------------------------
create view public.usage_live_24h with (security_invoker = true) as
  select
    user_id,
    coalesce(sum(total_tokens),  0)::bigint as total_tokens,
    coalesce(sum(input_tokens),  0)::bigint as input_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens,
    coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
    coalesce(sum(cost_usd),      0)          as cost_usd,
    count(*)::int                            as event_count
  from public.usage_events
  where occurred_at >= now() - interval '24 hours'
  group by user_id;

create view public.usage_weekly_compare with (security_invoker = true) as
  with bounds as (
    select
      date_trunc('week', now() at time zone 'UTC')::date                         as this_week_start,
      (date_trunc('week', now() at time zone 'UTC') - interval '7 days')::date   as last_week_start,
      (date_trunc('week', now() at time zone 'UTC') + interval '7 days')::date   as next_week_start
  )
  select
    d.user_id,
    sum(case when d.day >= b.this_week_start and d.day < b.next_week_start       then d.total_tokens else 0 end)::bigint as this_week_tokens,
    sum(case when d.day >= b.last_week_start and d.day < b.this_week_start       then d.total_tokens else 0 end)::bigint as last_week_tokens,
    sum(case when d.day >= b.this_week_start and d.day < b.next_week_start       then d.cost_usd else 0 end) as this_week_cost,
    sum(case when d.day >= b.last_week_start and d.day < b.this_week_start       then d.cost_usd else 0 end) as last_week_cost
  from public.daily_rollups d
  cross join bounds b
  group by d.user_id;

-- Views inherit RLS via security_invoker; no direct policies needed.
revoke all on public.usage_live_24h      from public;
revoke all on public.usage_weekly_compare from public;
grant select on public.usage_live_24h      to authenticated;
grant select on public.usage_weekly_compare to authenticated;

-- ------------------------------------------------------------------
-- RPC: ingest_usage — atomic, idempotent insert used by Edge Function
-- ------------------------------------------------------------------
create or replace function public.ingest_usage(
  p_user_id        uuid,
  p_provider       llm_provider,
  p_model          text,
  p_input_tokens   integer,
  p_output_tokens  integer,
  p_cached_tokens  integer,
  p_cost_usd       numeric,
  p_source         text,
  p_client_event_id text,
  p_occurred_at    timestamptz
) returns public.usage_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.usage_events;
begin
  insert into public.usage_events
    (user_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, client_event_id, occurred_at)
  values
    (p_user_id, p_provider, p_model,
     greatest(coalesce(p_input_tokens, 0),  0),
     greatest(coalesce(p_output_tokens, 0), 0),
     greatest(coalesce(p_cached_tokens, 0), 0),
     greatest(coalesce(p_cost_usd, 0),      0),
     coalesce(p_source, 'extension'),
     p_client_event_id,
     coalesce(p_occurred_at, now()))
  on conflict (user_id, client_event_id) do update
    set occurred_at = excluded.occurred_at  -- noop-ish: keeps idempotency silent
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ingest_usage(uuid, llm_provider, text, integer, integer, integer, numeric, text, text, timestamptz) from public, anon, authenticated;
-- Only the Edge Function (service role) calls this. Do not expose to clients.

-- ------------------------------------------------------------------
-- Bootstrap: auto-create a profiles row for each new auth.users
-- ------------------------------------------------------------------
create or replace function public.tt_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

revoke all on function public.tt_handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tt_handle_new_user();

-- ------------------------------------------------------------------
-- Realtime: broadcast changes on usage_events and daily_rollups
-- ------------------------------------------------------------------
alter publication supabase_realtime add table public.usage_events;
alter publication supabase_realtime add table public.daily_rollups;
