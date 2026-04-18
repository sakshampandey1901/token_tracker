import * as vscode from "vscode";
import {
  DEFAULT_DAILY_TOKEN_LIMIT,
  DEFAULT_DAILY_TOKEN_LIMIT_CLAUDE,
  DEFAULT_DAILY_TOKEN_LIMIT_CODEX,
} from "./shared";
import { EventStore } from "./store";
import { StatusBar } from "./status-bar";
import { startLocalServer, LocalServer } from "./local-server";
import { registerCommands } from "./commands";
import { DashboardViewProvider } from "./dashboard-view";
import { ClaudeCodeWatcher } from "./watchers/claude-code";
import { CodexWatcher } from "./watchers/codex";

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("tokenTracker");

  const store = await EventStore.open(ctx);

  const getDailyLimit = () => {
    const v = Number(cfg().get("dailyTokenLimit"));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
  };

  const getSourceDailyLimits = () => {
    const claudeRaw = Number(cfg().get("dailyTokenLimitClaude"));
    const codexRaw = Number(cfg().get("dailyTokenLimitCodex"));
    return {
      "claude-code":
        Number.isFinite(claudeRaw) && claudeRaw >= 0
          ? claudeRaw
          : DEFAULT_DAILY_TOKEN_LIMIT_CLAUDE,
      codex:
        Number.isFinite(codexRaw) && codexRaw >= 0
          ? codexRaw
          : DEFAULT_DAILY_TOKEN_LIMIT_CODEX,
    };
  };

  const status = new StatusBar(store, { getDailyLimit });
  ctx.subscriptions.push(status);

  const sidebar = new DashboardViewProvider(store, getDailyLimit, getSourceDailyLimits);
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

  let codexWatcher: CodexWatcher | null = null;
  const maybeStartCodexWatcher = async () => {
    const enabled = Boolean(cfg().get("codex.enabled") ?? true);
    if (codexWatcher) {
      codexWatcher.dispose();
      codexWatcher = null;
    }
    if (!enabled) return;
    codexWatcher = new CodexWatcher(ctx, store);
    try {
      await codexWatcher.start();
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Token Tracker: Codex watcher failed to start — ${(err as Error).message}`,
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
      if (
        e.affectsConfiguration("tokenTracker.dailyTokenLimitClaude") ||
        e.affectsConfiguration("tokenTracker.dailyTokenLimitCodex")
      ) {
        sidebar.render();
      }
      if (e.affectsConfiguration("tokenTracker.claudeCode.enabled")) {
        await maybeStartClaudeWatcher();
      }
      if (e.affectsConfiguration("tokenTracker.codex.enabled")) {
        await maybeStartCodexWatcher();
      }
    }),
  );

  registerCommands(ctx, { store, status, getDailyLimit, getSourceDailyLimits });

  await maybeStartServer();
  await maybeStartClaudeWatcher();
  await maybeStartCodexWatcher();

  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (server) void server.stop();
      if (claudeWatcher) claudeWatcher.dispose();
      if (codexWatcher) codexWatcher.dispose();
    }),
  );
}

export function deactivate() {
  /* resources disposed via ctx.subscriptions */
}
