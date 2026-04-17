import * as vscode from "vscode";
import { ApiClient } from "./api-client";
import { StatusBar } from "./status-bar";
import { startLocalServer, LocalServer } from "./local-server";
import { registerCommands } from "./commands";
import { handlePairUri } from "./pair";
import { DEFAULTS } from "./defaults";

const SECRET_KEY_INGEST = "tokenTracker.ingestToken";

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("tokenTracker");

  // On first run with baked-in defaults, seed the settings so the rest of the
  // extension sees a populated supabaseUrl / dashboardUrl without the user
  // doing anything. We only write if the setting is still empty.
  await seedDefaults(cfg);

  const api = new ApiClient({
    getSupabaseUrl: () =>
      String(cfg().get("supabaseUrl") || "").trim() || DEFAULTS.supabaseUrl,
    getIngestToken: async () => (await ctx.secrets.get(SECRET_KEY_INGEST)) ?? "",
  });

  const status = new StatusBar(api, {
    getPollInterval: () =>
      Math.max(10, Number(cfg().get("pollIntervalSeconds") ?? 30)) * 1000,
    getDashboardUrl: () =>
      String(cfg().get("dashboardUrl") || "").trim() || DEFAULTS.dashboardUrl,
  });

  let server: LocalServer | null = null;
  const maybeStartServer = async () => {
    const enabled = Boolean(cfg().get("enableLocalIngest"));
    const port = Number(cfg().get("localIngestPort") ?? 58417);
    if (server) await server.stop();
    server = enabled ? await startLocalServer(port, api) : null;
  };

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

  // Handle vscode://token-tracker.token-tracker/pair?code=<one-time>
  ctx.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path !== "/pair") {
          void vscode.window.showWarningMessage(
            `Token Tracker: unknown URI path "${uri.path}".`,
          );
          return;
        }
        void handlePairUri(uri, ctx, SECRET_KEY_INGEST, async () => {
          await status.refreshNow();
        });
      },
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

async function seedDefaults(cfg: () => vscode.WorkspaceConfiguration) {
  const c = cfg();
  if (DEFAULTS.dashboardUrl && !String(c.get("dashboardUrl") || "").trim()) {
    await c.update("dashboardUrl", DEFAULTS.dashboardUrl, vscode.ConfigurationTarget.Global);
  }
  if (DEFAULTS.supabaseUrl && !String(c.get("supabaseUrl") || "").trim()) {
    await c.update("supabaseUrl", DEFAULTS.supabaseUrl, vscode.ConfigurationTarget.Global);
  }
}
