-- Token Tracker — pairing codes
-- Short-lived one-time codes used to hand off an `ingest_token` from the
-- browser to the VS Code / Cursor extension without the user pasting anything.

set search_path = public;

create table public.pairing_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  editor_scheme text not null default 'vscode',  -- 'vscode' | 'cursor'
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pairing_codes_user_idx on public.pairing_codes (user_id, created_at desc);
create index pairing_codes_expiry_idx on public.pairing_codes (expires_at);

alter table public.pairing_codes enable row level security;
-- Clients never read this table directly — only the Next.js API routes using
-- the service role do. No policies grant access to anon/authenticated.

-- Best-effort cleanup: delete codes older than 1 hour whenever a new one is created.
create or replace function public.tt_prune_pairing_codes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pairing_codes
   where expires_at < now() - interval '1 hour'
      or consumed_at < now() - interval '1 hour';
  return null;
end;
$$;

revoke all on function public.tt_prune_pairing_codes() from public, anon, authenticated;

create trigger pairing_codes_prune
  after insert on public.pairing_codes
  for each statement execute function public.tt_prune_pairing_codes();
