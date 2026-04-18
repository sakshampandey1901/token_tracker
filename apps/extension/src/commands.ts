import * as vscode from "vscode";
import type { EventStore } from "./store";
import type { StatusBar } from "./status-bar";
import type { LlmProvider } from "@token-tracker/shared";
import { DashboardPanel } from "./dashboard";

interface Deps {
  store: EventStore;
  status: StatusBar;
  getDailyLimit: () => number;
}

export function registerCommands(ctx: vscode.ExtensionContext, deps: Deps) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("tokenTracker.openDashboard", () =>
      DashboardPanel.show(deps.store, deps.getDailyLimit),
    ),
    vscode.commands.registerCommand("tokenTracker.focusSidebar", () =>
      vscode.commands.executeCommand("tokenTracker.sidebar.focus"),
    ),
    vscode.commands.registerCommand("tokenTracker.refresh", () => deps.status.render()),
    vscode.commands.registerCommand("tokenTracker.reportUsage", (raw) => reportUsage(deps.store, raw)),
    vscode.commands.registerCommand("tokenTracker.exportEvents", () => exportEvents(deps.store)),
    vscode.commands.registerCommand("tokenTracker.clearEvents", () => clearEvents(deps.store)),
  );
}

async function reportUsage(store: EventStore, raw: unknown) {
  if (!raw || typeof raw !== "object") {
    vscode.window.showWarningMessage("tokenTracker.reportUsage: expected an object.");
    return;
  }
  const r = raw as {
    provider?: LlmProvider;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cost_usd?: number;
    source?: string;
    client_event_id?: string;
    occurred_at?: string;
  };
  if (!r.provider || !r.model) {
    vscode.window.showWarningMessage("tokenTracker.reportUsage: provider + model required.");
    return;
  }
  await store.record({
    provider: r.provider,
    model: r.model,
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cached_tokens: r.cached_tokens,
    cost_usd: r.cost_usd,
    source: r.source ?? "programmatic",
    client_event_id: r.client_event_id,
    occurred_at: r.occurred_at,
  });
}

async function exportEvents(store: EventStore) {
  const target = await vscode.window.showSaveDialog({
    filters: { JSON: ["json"] },
    saveLabel: "Export Token Tracker events",
    defaultUri: vscode.Uri.file(`token-tracker-${new Date().toISOString().slice(0, 10)}.json`),
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(store.exportJson(), "utf8"));
  vscode.window.showInformationMessage(`Token Tracker: exported ${store.all().length} events.`);
}

async function clearEvents(store: EventStore) {
  const pick = await vscode.window.showWarningMessage(
    "Delete all Token Tracker events? This cannot be undone.",
    { modal: true },
    "Delete",
  );
  if (pick !== "Delete") return;
  await store.clear();
  vscode.window.showInformationMessage("Token Tracker: event history cleared.");
}
