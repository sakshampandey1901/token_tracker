# Token Tracker

> Free, open-source, **local-only** LLM token usage tracker for VS Code and Cursor.

- **Status bar meter** — rolling 24-hour token count vs. your configured daily budget
- **Built-in dashboard** — 7-day bar chart, weekly comparison, per-provider breakdown, live feed, all rendered in a VS Code webview
- **Local ingest** — POST to `http://127.0.0.1:58417/ingest` from any script or tool
- **No backend, no account, no network** — every event lives in a single JSON-lines file under the extension's `globalStorage`
- **Works in VS Code and Cursor** — same `.vsix`

```
┌────────────────────────────┐     ┌───────────────────────────────┐
│  Your code / scripts       │     │   Token Tracker extension     │
│  curl 127.0.0.1:58417 ─────┼──▶ │  - loopback HTTP ingest        │
│  reportUsage command  ─────┼──▶ │  - event store (JSON-lines)    │
└────────────────────────────┘     │  - status bar + webview UI    │
                                   └───────────────────────────────┘
                                                   │
                                                   ▼
                                   ~/.../globalStorage/events.ndjson
```

---

## Install from source

### Prereqs

- Node ≥ 18.18
- `pnpm` ≥ 9 (`npm i -g pnpm`)

### 1. Clone and build

```bash
git clone https://github.com/your-org/token-tracker.git
cd token-tracker
pnpm install
pnpm package:ext
# -> apps/extension/token-tracker.vsix
```

### 2. Install into VS Code or Cursor

```bash
# VS Code
code --install-extension apps/extension/token-tracker.vsix

# Cursor (same VSIX — Cursor reuses the VS Code extension API)
cursor --install-extension apps/extension/token-tracker.vsix
```

Reload the window. You should see a `$(graph) 0 / 1M` item on the right side of the status bar.

### 3. Report your first event

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"openai","model":"gpt-4o","input_tokens":1234,"output_tokens":567}'
```

Click the status bar item — the dashboard opens and the event appears in the live feed.

---

## Commands

Accessible from the command palette:

| Command                               | What it does                                               |
| ------------------------------------- | ---------------------------------------------------------- |
| `Token Tracker: Open dashboard`       | Opens the local webview dashboard                          |
| `Token Tracker: Refresh status bar`   | Forces the status bar to re-render                         |
| `Token Tracker: Export events to JSON`| Writes the full event history to a file                    |
| `Token Tracker: Clear event history`  | Deletes every stored event (requires confirmation)         |
| `Token Tracker: Report usage event`   | Programmatic entry point — see below                       |

## Settings

| Setting                            | Default   | Notes                                                    |
| ---------------------------------- | --------- | -------------------------------------------------------- |
| `tokenTracker.dailyTokenLimit`     | `1000000` | Used by the 24h meter. Set to `0` to hide the meter.     |
| `tokenTracker.enableLocalIngest`   | `true`    | Loopback HTTP listener for `/ingest` + `/healthz`.       |
| `tokenTracker.localIngestPort`     | `58417`   | Bound to `127.0.0.1` only.                               |

## Report usage programmatically

From another VS Code or Cursor extension:

```ts
await vscode.commands.executeCommand("tokenTracker.reportUsage", {
  provider: "openai",
  model: "gpt-4o",
  input_tokens: 1234,
  output_tokens: 567,
  // optional:
  cached_tokens: 0,
  cost_usd: 0.0123,          // if omitted, estimated from packages/shared/src/pricing.ts
  source: "my-extension",    // free-form tag shown in the live feed
  client_event_id: "…",      // used to dedupe on retry
});
```

From any local process:

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","model":"claude-3-5-sonnet-latest","input_tokens":1200,"output_tokens":400}'
```

## Project layout

```
apps/
  extension/    VS Code / Cursor extension (TypeScript, esbuild)
packages/
  shared/       Types + local pricing table shared with the extension
```

## What happened to the hosted dashboard and Supabase?

Earlier iterations of this project shipped a Next.js dashboard, Supabase
migrations, Edge Functions, and a browser sign-in flow. That path has been
removed — the project is now local-only by design. Your usage never leaves
your machine.

## License

MIT — see [LICENSE](./LICENSE).
