# Token Tracker — VS Code & Cursor extension

Shows live LLM token usage in your status bar and streams every event
to your personal [Token Tracker dashboard](../web).

## Install

### From source (dev)
```bash
pnpm install
pnpm --filter @token-tracker/extension build
# then in VS Code / Cursor: "Developer: Install Extension from Location…"
# and pick this folder.
```

### From a .vsix
```bash
pnpm --filter @token-tracker/extension package
code --install-extension apps/extension/token-tracker.vsix
# or: cursor --install-extension apps/extension/token-tracker.vsix
```

## Configure

1. Run **Token Tracker: Sign in** from the command palette.
2. Paste your **Supabase URL** (e.g. `https://xxx.supabase.co`) and the
   **ingest token** copied from the dashboard's "Extension pairing" card.
3. Done — a status bar item like `◉ 42.1K / 1M` appears.

Your ingest token is stored in VS Code's OS-level `SecretStorage`
(Keychain on macOS, Credential Manager on Windows, libsecret on Linux).
It never touches the settings file or the repo.

## Report usage programmatically

Other extensions or scripts can push usage events via:

```ts
await vscode.commands.executeCommand("tokenTracker.reportUsage", {
  provider: "openai",
  model: "gpt-4o",
  input_tokens: 1234,
  output_tokens: 567,
});
```

Or, from any process on your machine, POST to the local endpoint:

```bash
curl -X POST http://127.0.0.1:58417/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","model":"claude-3-5-sonnet-latest","input_tokens":1200,"output_tokens":400}'
```

The extension adds your ingest token and forwards to Supabase.
