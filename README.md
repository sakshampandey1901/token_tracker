# Token Tracker

> Free, open-source, real-time LLM token usage tracker.
> A live dashboard + a VS Code / Cursor extension, backed by Supabase (free tier).

- **Live dashboard on the home screen** — 24-hour rolling meter against your tier limit
- **Weekly comparison** — this week vs. last week, per day, per provider
- **Real-time** — every call streams to the dashboard within ~1s via Supabase Realtime
- **Secure by default** — Row-Level Security on every table, per-user rotatable ingest tokens, secrets in OS keychain
- **Three ways to run it** — hosted web app, VS Code / Cursor extension, or `git clone` and self-host

```
┌─────────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────┐
│ VS Code / Cursor ext.   │──▶  │  Supabase Edge Function  │──▶  │  Postgres + Realtime │
│  (local HTTP + status)  │     │  /functions/v1/ingest    │     │  (RLS per user)      │
└─────────────────────────┘     └──────────────────────────┘     └──────────┬───────────┘
                                                                            │
                                                                            ▼
                                                                 ┌──────────────────────┐
                                                                 │ Next.js dashboard    │
                                                                 │ (realtime subscribe) │
                                                                 └──────────────────────┘
```

---

## For end users — one click

If someone has already deployed an instance for you:

1. Install the extension from the VS Code Marketplace (or `cursor --install-extension token-tracker.vsix`)
2. Click the `⏺ Token Tracker: sign in` item in the status bar
3. A browser tab opens — sign in with GitHub or Google
4. Click **Open VS Code** (or **Open Cursor**) on the pair screen
5. Status bar updates to `⏺ 0 / 100K`. Done.

The extension never asks you for a URL or a token — those are baked into the
build. A one-time pairing code (expires in 5 min, consumed on first use) is
the only thing that travels between the browser and your editor.

---

## For operators — deploy once, then share

### A. Hosting checklist

```bash
# 1. Create a Supabase project and apply the schema
supabase link --project-ref <ref>
supabase db push
supabase functions deploy ingest status rotate-token

# 2. Deploy the dashboard (Vercel in this example)
cd apps/web
vercel link && vercel env add NEXT_PUBLIC_SUPABASE_URL production
                vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
                vercel env add SUPABASE_SERVICE_ROLE_KEY production   # server-only
vercel --prod   # -> https://tokentracker.example.com

# 3. Ship an extension pointing at your instance
cd ../extension
TT_DASHBOARD_URL=https://tokentracker.example.com \
TT_SUPABASE_URL=https://<ref>.supabase.co \
TT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx \
pnpm package
# -> token-tracker.vsix  (distribute this)
```

End users who install that VSIX get the one-click flow above — no settings to fill in.

---

## Self-host from source (~5 minutes)

### Prereqs
- Node ≥ 18.18, `pnpm` ≥ 9 (`npm i -g pnpm`)
- [Supabase account](https://app.supabase.com) (free tier is enough)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase` or [download](https://github.com/supabase/cli/releases))

### 1. Clone and install

```bash
git clone https://github.com/your-org/token-tracker.git
cd token-tracker
pnpm install
```

### 2. Create a Supabase project and apply migrations

```bash
# Link your local repo to the hosted project
supabase login
supabase link --project-ref <your-project-ref>

# Push the schema + RLS policies
supabase db push
# Deploy the three Edge Functions
supabase functions deploy ingest
supabase functions deploy status
supabase functions deploy rotate-token

# Set the shared secret the functions need (service role is auto-wired)
supabase secrets set SUPABASE_ANON_KEY="<your anon / publishable key>"
```

### 3. Configure and run the dashboard

```bash
cp .env.example apps/web/.env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
pnpm dev:web
# → http://localhost:3000
```

Sign in with GitHub, Google, or a magic link. The dashboard renders immediately
with a `0 / 100K` meter and an "Extension pairing" card containing your ingest token.

### 4. Install the extension

```bash
# VS Code
pnpm --filter @token-tracker/extension package
code --install-extension apps/extension/token-tracker.vsix

# Cursor (same VSIX, different binary name)
cursor --install-extension apps/extension/token-tracker.vsix
```

Open the command palette, run **Token Tracker: Sign in**, paste the Supabase URL
and the ingest token from the dashboard. You should see a status-bar item like
`⏺ 0 / 100K` appear on the right.

### 5. Send a test event

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"openai","model":"gpt-4o","input_tokens":1234,"output_tokens":567}'
```

The dashboard updates in realtime, the status bar ticks up within ~30s.

---

## Project layout

```
apps/
  web/          Next.js 14 dashboard (App Router, Tailwind, Recharts)
  extension/    VS Code / Cursor extension (TypeScript, esbuild, no bundled runtime)
packages/
  shared/       Types + pricing table shared by web + extension
supabase/
  migrations/   SQL: tables, RLS policies, triggers, views
  functions/    Edge Functions: ingest / status / rotate-token
```

## How auth works

Two complementary mechanisms, each appropriate for where it runs:

| Surface        | Auth mechanism                                                 | Why                                                                                   |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web dashboard  | Supabase Auth (OAuth or email magic link) with SSR cookie      | Browser sessions, supports RLS using `auth.uid()`                                     |
| Extension / CLI| Per-user, rotatable `ingest_token` (hex, stored in SecretStorage) | No OAuth round-trip from an IDE; rotatable if leaked; validated server-side in Edge Functions |
| Browser → editor handoff | One-time `pairing_code` (expires 5 min, consumed once) | Lets the user sign in on the website and silently install the `ingest_token` into the editor without copy/paste |

`ingest_token` is **write-only** from the extension's perspective — it authorizes
inserts into `usage_events`. All reads still go through the dashboard's
authenticated session and RLS.

## How 24-hour monitoring works

1. Extension POSTs an event → `/functions/v1/ingest`
2. Edge Function validates the `ingest_token`, calls `ingest_usage()` RPC
3. RPC inserts into `usage_events` (append-only)
4. Trigger `usage_events_bump_daily` updates `daily_rollups` (one row per user per UTC day)
5. Supabase Realtime broadcasts the INSERT
6. Dashboard subscription pushes it into the UI; extension's status bar polls the `status` Edge Function every 30s

The `usage_live_24h` view (security_invoker) computes the rolling window on demand.
A re-sync fires every 60s in the dashboard in case realtime misses a message.

## Security checklist (what's enforced)

- RLS enabled on `profiles`, `usage_events`, `daily_rollups`
- SELECT policies restrict every row to `auth.uid() = user_id`
- No INSERT/UPDATE policies outside the owner's own rows
- `views` use `WITH (security_invoker = true)` so RLS is enforced through them
- `security definer` RPCs are `REVOKE`'d from `anon` + `authenticated` — only the service role (inside Edge Functions) can call them
- `ingest_token` is generated via `gen_random_bytes(32)`, stored hex, rotatable
- No `service_role` key is ever shipped to the browser or the extension
- Extension stores its token in VS Code `SecretStorage` (OS keychain), never in `settings.json`
- Local HTTP ingest binds to `127.0.0.1` only, rejects non-loopback requests

## Self-hosted is free

Everything in this repo runs on Supabase's free tier:
- 500 MB Postgres, 50k monthly auth users, 2M Edge Function invocations/month
- No paid providers — the extension computes token costs client-side from a local pricing table in `packages/shared/src/pricing.ts`

## Distribution

- **Clone the repo** — the recommended path for now
- **Install the extension**:
  - VS Code Marketplace: (TODO — publish with `vsce publish`)
  - Cursor: same `.vsix` as VS Code (Cursor reuses the VS Code extension API)
- **Website extension**: deploy `apps/web` to Vercel or any Next.js host;
  the extension just needs your `SUPABASE_URL` and the user's ingest token.

## License

MIT — see [LICENSE](./LICENSE).
