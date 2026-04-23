# Token Tracker
> Keep track of token usage of your CLI agents while coding (claude and codex).

## Dashboard

Status bar + sidebar/editor views:

![Token Tracker status tooltip](docs/images/dashboard-status-tooltip.png)

![Token Tracker sidebar and editor dashboard](docs/images/dashboard-sidebar-editor.png)

- **Status bar meter**: rolling 24-hour **burn** tokens vs `tokenTracker.dailyTokenLimit`  
  (`burn` = `input_tokens + output_tokens`; cached tokens are **not** included in this total)
- **Sidebar + editor dashboard**:
  - 7-day chart, weekly comparison, per-provider table, live event feed
  - **By project (24h)**: usage grouped by working directory when the tool reports it; comparative **input vs output** bar per project (cached is **not** part of the bar split)
- **Source bars (Claude / Codex)**: rolling **last 5 hours** of **burn** vs your per-source caps (`tokenTracker.dailyTokenLimitClaude` / `tokenTracker.dailyTokenLimitCodex`)
- **Rate-limit section**:
  - **Codex**: authoritative windows when rollout `rate_limits` metadata is present
  - **Claude** (and Codex fallback): observed windows (`5h` / `7d`) derived from local events; observed token counts use **input + output** only
- **Local ingest API**: POST to `http://127.0.0.1:58417/ingest`
- **No backend, no account**: data stays on-device in extension storage

### Token accounting (how numbers are calculated)

- Each stored event has **`input_tokens`**, **`output_tokens`**, and optionally **`cached_tokens`** (e.g. Anthropic cache read/creation).
- **`total_tokens` in the event store is always `input_tokens + output_tokens`** — cached usage is **not** added into that total.
- **Cost** (when not supplied) can still use cached tokens for pricing estimates, but **UI “burn” meters and source bars** intentionally use **input + output** so cache traffic does not inflate the headline numbers.
- **Claude Code**: cache fields from local JSONL are stored as `cached_tokens` for cost/context; burn totals follow the rule above.
- **Codex**: per-turn usage comes from `last_token_usage`. When the CLI provides **`total_tokens`**, the extension aligns stored input/output to that (and does not treat `cached_input_tokens` as extra burn).

---

## Install from source

### Prereqs

- Node >= 18.18
- `pnpm` >= 9 (`npm i -g pnpm`)

### 1) Clone and build/package

```bash
git clone https://github.com/your-org/token-tracker.git
cd token-tracker
pnpm install
pnpm package:ext
# -> apps/extension/token-tracker.vsix
```

If `vsce package` fails (for example during optional secret scanning), you can still run `pnpm build:ext` to produce `apps/extension/dist/extension.js` and package manually, or fix your local `vsce` / Node environment and retry.

### 2) Install into VS Code or Cursor

```bash
# VS Code
code --install-extension apps/extension/token-tracker.vsix

# Cursor
cursor --install-extension apps/extension/token-tracker.vsix
```

Reload the window after install.

---

## Commands

From Command Palette:

| Command | What it does |
| --- | --- |
| `Token Tracker: Open dashboard in editor` | Opens full dashboard webview panel |
| `Token Tracker: Focus sidebar` | Focuses Token Tracker sidebar view |
| `Token Tracker: Refresh` | Re-renders the status bar |
| `Token Tracker: Report usage event (programmatic)` | Programmatic ingest command |
| `Token Tracker: Export events to JSON` | Exports full local event history |
| `Token Tracker: Clear event history` | Deletes all stored events (with confirmation) |

---

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `tokenTracker.dailyTokenLimit` | `1000000` | Global status-bar 24h meter limit; set `0` to hide meter |
| `tokenTracker.dailyTokenLimitClaude` | `1000000` | Configured cap for the Claude **5h burn** source bar (input + output vs this cap) |
| `tokenTracker.dailyTokenLimitCodex` | `1000000` | Configured cap for the Codex **5h burn** source bar (input + output vs this cap) |
| `tokenTracker.enableLocalIngest` | `true` | Enables loopback HTTP ingest server |
| `tokenTracker.localIngestPort` | `58417` | Ingest port (binds to `127.0.0.1` only) |
| `tokenTracker.claudeCode.enabled` | `true` | Watches `~/.claude/projects/**/*.jsonl` for Claude Code usage |
| `tokenTracker.codex.enabled` | `true` | Watches `~/.codex/sessions/**/*.jsonl` for Codex usage + limits |

---

## Automatic watchers

### Claude watcher

- Watches `~/.claude/projects/**/*.jsonl`
- Ingests assistant message token usage
- Tags events with **`project`** when the assistant row includes `cwd` (absolute path to the session working directory)
- Claude local logs currently do not expose authoritative plan/quota/reset fields
- Emits observed fallback windows:
  - `5h` (rolling)
  - `7d` (rolling)

### Codex watcher

- Watches `~/.codex/sessions/**/*.jsonl`
- Ingests per-turn token usage (`last_token_usage`)
- Tags events with **`project`** from the rollout’s `session_meta` `cwd` (the file head is read on resume if needed)
- Uses authoritative `rate_limits` metadata when present (`used_percent`, `window_minutes`, `resets_at`, `plan_type`)
- Falls back to observed `5h`/`7d` windows when metadata is missing

---

## Programmatic ingest

### From another extension

```ts
await vscode.commands.executeCommand("tokenTracker.reportUsage", {
  provider: "openai",
  model: "gpt-4o",
  input_tokens: 1234,
  output_tokens: 567,
  // optional:
  cached_tokens: 0,
  cost_usd: 0.0123,              // if omitted, estimated from apps/extension/src/shared/pricing.ts
  source: "my-extension",        // free-form source label
  project: "/abs/path/to/repo",  // optional: groups "By project (24h)"
  client_event_id: "retry-safe-id",
  occurred_at: new Date().toISOString(),
});
```

### From any local process

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","model":"claude-opus-4-6","input_tokens":1200,"output_tokens":400,"project":"/abs/path/to/repo"}'
```

Optional health check:

```bash
curl http://127.0.0.1:58417/healthz
```

---

## Data model notes

- Event history is stored locally in extension global storage as newline-delimited JSON (`events.ndjson`)
- **Status bar**: rolling **24h** aggregate of **input + output**
- **Source bars**: rolling **5h** **burn** (input + output) vs configured caps
- **By project (24h)**: rolling **24h** aggregates keyed by `project` (or `unknown` when not reported)
- Rate-limit rows may be **authoritative** (Codex metadata) or **observed** (local counts over the window)

---

## Project layout

```text
apps/
  extension/    VS Code/Cursor extension (TypeScript + esbuild)
```

## License

MIT — see [LICENSE](./LICENSE).
