# Token Tracker — VS Code & Cursor extension

Local-only LLM token usage tracker. Status bar meter + webview dashboard,
backed by a single JSON-lines file under the extension's `globalStorage`.
No backend, no account, no telemetry.

## Install

### From a .vsix

```bash
pnpm install
pnpm --filter token-tracker package

code   --install-extension apps/extension/token-tracker.vsix
# or
cursor --install-extension apps/extension/token-tracker.vsix
```

### From source (dev)

```bash
pnpm install
pnpm --filter token-tracker build
# then in VS Code / Cursor: "Developer: Install Extension from Location…"
# and pick this folder.
```

Or run the watcher and launch the extension host from VS Code's **Run and Debug** panel:

```bash
pnpm --filter token-tracker watch
```

## Usage

1. Reload the window after install — a `$(graph) 0 / 1M` item appears in the status bar.
2. Click it to open the dashboard.
3. Push events from scripts, agents, or other extensions (see below).

Adjust your daily budget via `tokenTracker.dailyTokenLimit` in settings.

## Report usage

Programmatically, from another extension:

```ts
await vscode.commands.executeCommand("tokenTracker.reportUsage", {
  provider: "openai",
  model: "gpt-4o",
  input_tokens: 1234,
  output_tokens: 567,
});
```

Over HTTP, from any local process:

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","model":"claude-3-5-sonnet-latest","input_tokens":1200,"output_tokens":400}'
```

Cost is estimated locally from `packages/shared/src/pricing.ts` if the caller
doesn't supply it. Pass `client_event_id` if your caller retries — it's used
for de-duplication.

## Where is my data?

In one file:

```
<VS Code globalStorage>/token-tracker.token-tracker/events.ndjson
```

Use **Token Tracker: Export events to JSON** to copy it elsewhere, or
**Token Tracker: Clear event history** to wipe it. Events older than
~60 days are dropped automatically on startup.
