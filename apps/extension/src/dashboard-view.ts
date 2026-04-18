import * as vscode from "vscode";
import type { EventStore } from "./store";
import { renderDashboardHtml } from "./dashboard";

/**
 * Sidebar webview that lives in the Token Tracker activity bar container.
 * Always re-rendered from the local EventStore; auto-refreshes on store changes.
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tokenTracker.sidebar";

  private view: vscode.WebviewView | null = null;
  private storeSub: vscode.Disposable | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: EventStore,
    private readonly getDailyLimit: () => number,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };

    this.storeSub?.dispose();
    this.storeSub = this.store.onChange(() => this.render());

    // Tick once a minute so the "resets in …" countdown stays current even
    // when no new events arrive.
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.render(), 60_000);

    view.onDidDispose(() => {
      this.view = null;
      this.storeSub?.dispose();
      this.storeSub = null;
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.tickTimer = null;
    });

    this.render();
  }

  render(): void {
    if (!this.view) return;
    const snap = this.store.snapshot(Math.max(0, this.getDailyLimit()));
    this.view.webview.html = renderDashboardHtml(snap, { layout: "compact" });
  }
}
