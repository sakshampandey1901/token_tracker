import * as vscode from "vscode";
import { DEFAULT_DAILY_TOKEN_LIMIT } from "@token-tracker/shared";
import { EventStore } from "./store";
import { StatusBar } from "./status-bar";
import { startLocalServer, LocalServer } from "./local-server";
import { registerCommands } from "./commands";
import { DashboardViewProvider } from "./dashboard-view";
import { ClaudeCodeWatcher } from "./watchers/claude-code";

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("tokenTracker");

  const store = await EventStore.open(ctx);

  const getDailyLimit = () => {
    const v = Number(cfg().get("dailyTokenLimit"));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
  };

  const status = new StatusBar(store, { getDailyLimit });
  ctx.subscriptions.push(status);

  const sidebar = new DashboardViewProvider(store, getDailyLimit);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  let claudeWatcher: ClaudeCodeWatcher | null = null;
  const maybeStartClaudeWatcher = async () => {
    const enabled = Boolean(cfg().get("claudeCode.enabled") ?? true);
    if (claudeWatcher) {
      claudeWatcher.dispose();
      claudeWatcher = null;
    }
    if (!enabled) return;
    claudeWatcher = new ClaudeCodeWatcher(ctx, store);
    try {
      await claudeWatcher.start();
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Token Tracker: Claude Code watcher failed to start — ${(err as Error).message}`,
      );
    }
  };

  let server: LocalServer | null = null;
  const maybeStartServer = async () => {
    const enabled = Boolean(cfg().get("enableLocalIngest"));
    const port = Number(cfg().get("localIngestPort") ?? 58417);
    if (server) {
      await server.stop();
      server = null;
    }
    if (!enabled) return;
    try {
      server = await startLocalServer(port, store);
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Token Tracker: could not bind local ingest on 127.0.0.1:${port} — ${(err as Error).message}`,
      );
    }
  };

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("tokenTracker.enableLocalIngest") ||
        e.affectsConfiguration("tokenTracker.localIngestPort")
      ) {
        await maybeStartServer();
      }
      if (e.affectsConfiguration("tokenTracker.dailyTokenLimit")) {
        status.render();
        sidebar.render();
      }
      if (e.affectsConfiguration("tokenTracker.claudeCode.enabled")) {
        await maybeStartClaudeWatcher();
      }
    }),
  );

  registerCommands(ctx, { store, status, getDailyLimit });

  await maybeStartServer();
  await maybeStartClaudeWatcher();

  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (server) void server.stop();
      if (claudeWatcher) claudeWatcher.dispose();
    }),
  );
}

export function deactivate() {
  /* resources disposed via ctx.subscriptions */
}
