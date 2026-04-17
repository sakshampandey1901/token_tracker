import * as vscode from "vscode";
import type { EventStore } from "./store";

interface Opts {
  getDailyLimit: () => number;
}

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private sub: vscode.Disposable;

  constructor(private readonly store: EventStore, private readonly opts: Opts) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "tokenTracker.openDashboard";
    this.item.show();
    this.render();
    this.sub = this.store.onChange(() => this.render());
  }

  /** Force a re-render (e.g. after a setting change). */
  render() {
    const limit = Math.max(0, this.opts.getDailyLimit());
    const snap = this.store.snapshot(limit);
    const used = snap.window_24h.total_tokens;
    const pct  = limit > 0 ? (used / limit) * 100 : 0;

    const icon =
      limit === 0          ? "$(pulse)" :
      pct   >= 95          ? "$(error)" :
      pct   >= 80          ? "$(warning)" :
                             "$(graph)";

    this.item.text =
      limit > 0
        ? `${icon} ${fmt(used)} / ${fmt(limit)}`
        : `${icon} ${fmt(used)} tokens (24h)`;

    const delta = snap.this_week.total_tokens - snap.last_week.total_tokens;
    const deltaStr =
      snap.last_week.total_tokens === 0
        ? "—"
        : `${delta >= 0 ? "+" : ""}${((delta / Math.max(1, snap.last_week.total_tokens)) * 100).toFixed(1)}%`;

    const md = new vscode.MarkdownString(
      [
        `**Token Tracker** — local only`,
        ``,
        limit > 0
          ? `- 24h: \`${used.toLocaleString()}\` / \`${limit.toLocaleString()}\` (${pct.toFixed(1)}%)`
          : `- 24h: \`${used.toLocaleString()}\` tokens`,
        `- cost 24h: \`$${snap.window_24h.cost_usd.toFixed(4)}\``,
        `- events 24h: \`${snap.window_24h.event_count}\``,
        `- this week: \`${snap.this_week.total_tokens.toLocaleString()}\` vs last \`${snap.last_week.total_tokens.toLocaleString()}\` (${deltaStr})`,
        ``,
        `[Open dashboard](command:tokenTracker.openDashboard)`,
      ].join("\n"),
      true,
    );
    md.isTrusted = true;
    this.item.tooltip = md;

    this.item.backgroundColor =
      pct >= 95
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : pct >= 80
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  }

  dispose() {
    this.sub.dispose();
    this.item.dispose();
  }
}

function fmt(n: number): string {
  if (n < 1_000)     return n.toString();
  if (n < 1_000_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0) + "K";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
}
