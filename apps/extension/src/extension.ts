import * as vscode from "vscode";
import { ApiClient } from "./api-client";
import { StatusBar } from "./status-bar";
import { startLocalServer, LocalServer } from "./local-server";
import { registerCommands } from "./commands";

const SECRET_KEY_INGEST = "tokenTracker.ingestToken";

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("tokenTracker");

  const api = new ApiClient({
    getSupabaseUrl: () => String(cfg().get("supabaseUrl") ?? "").trim(),
    getIngestToken: async () => (await ctx.secrets.get(SECRET_KEY_INGEST)) ?? "",
  });

  const status = new StatusBar(api, {
    getPollInterval: () =>
      Math.max(10, Number(cfg().get("pollIntervalSeconds") ?? 30)) * 1000,
    getDashboardUrl: () =>
      String(cfg().get("dashboardUrl") ?? "http://localhost:3000"),
  });

  let server: LocalServer | null = null;
  const maybeStartServer = async () => {
    const enabled = Boolean(cfg().get("enableLocalIngest"));
    const port = Number(cfg().get("localIngestPort") ?? 58417);
    if (server) await server.stop();
    server = enabled ? await startLocalServer(port, api) : null;
  };

  // React to config changes without reloading the window.
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("tokenTracker.enableLocalIngest") ||
        e.affectsConfiguration("tokenTracker.localIngestPort")
      ) {
        await maybeStartServer();
      }
      if (e.affectsConfiguration("tokenTracker.pollIntervalSeconds")) {
        status.restart();
      }
    }),
  );

  registerCommands(ctx, {
    api,
    status,
    secretKey: SECRET_KEY_INGEST,
    onAuthChange: async () => {
      await status.refreshNow();
    },
  });

  ctx.subscriptions.push(status);
  status.start();
  await maybeStartServer();

  ctx.subscriptions.push(
    new vscode.Disposable(async () => {
      if (server) await server.stop();
    }),
  );
}

export function deactivate() {
  /* resources disposed via ctx.subscriptions */
}
