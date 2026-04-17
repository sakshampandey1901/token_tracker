import * as vscode from "vscode";
import type { ApiClient } from "./api-client";

interface Opts {
  getPollInterval: () => number;
  getDashboardUrl: () => string;
}

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly api: ApiClient, private readonly opts: Opts) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "tokenTracker.openDashboard";
    this.item.text = "$(graph) Token Tracker";
    this.item.tooltip = "Sign in to start tracking";
    this.item.show();
  }

  start() {
    this.restart();
  }

  restart() {
    if (this.timer) clearInterval(this.timer);
    const tick = () => void this.refreshNow();
    this.timer = setInterval(tick, this.opts.getPollInterval());
    tick();
  }

  async refreshNow() {
    if (!(await this.api.isConfigured())) {
      this.item.text = "$(graph) Token Tracker: sign in";
      this.item.tooltip = "Run 'Token Tracker: Sign in' to connect.";
      this.item.backgroundColor = undefined;
      return;
    }
    const s = await this.api.getStatus();
    if (!s) {
      this.item.text = "$(warning) Token Tracker: offline";
      this.item.tooltip = "Could not reach Supabase. Check network / URL.";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }
    const pct = s.daily_limit > 0 ? (s.total_tokens_24h / s.daily_limit) * 100 : 0;
    const icon = pct >= 95 ? "$(error)" : pct >= 80 ? "$(warning)" : "$(pulse)";
    this.item.text = `${icon} ${fmt(s.total_tokens_24h)} / ${fmt(s.daily_limit)}`;
    this.item.tooltip = new vscode.MarkdownString(
      [
        `**Token Tracker** — ${s.tier}`,
        ``,
        `- 24h: \`${s.total_tokens_24h.toLocaleString()}\` / \`${s.daily_limit.toLocaleString()}\` (${pct.toFixed(1)}%)`,
        `- cost 24h: \`$${s.cost_usd_24h.toFixed(4)}\``,
        `- events 24h: \`${s.event_count_24h}\``,
        `- this week: \`${s.this_week_tokens.toLocaleString()}\` vs last \`${s.last_week_tokens.toLocaleString()}\``,
        ``,
        `[Open dashboard](${this.opts.getDashboardUrl()})`,
      ].join("\n"),
    );
    this.item.backgroundColor =
      pct >= 95
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : pct >= 80
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}

function fmt(n: number): string {
  if (n < 1_000)     return n.toString();
  if (n < 1_000_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0) + "K";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
}
