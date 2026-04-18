import * as vscode from "vscode";
import type { EventStore } from "./store";
import type { RateLimitWindow } from "./shared";

interface Opts {
  getDailyLimit: () => number;
}

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private sub: vscode.Disposable;
  private tick: NodeJS.Timeout;

  constructor(private readonly store: EventStore, private readonly opts: Opts) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "tokenTracker.focusSidebar";
    this.item.show();
    this.render();
    this.sub = this.store.onChange(() => this.render());
    // Keep the "resets in …" countdown fresh without waiting for new events.
    this.tick = setInterval(() => this.render(), 60_000);
  }

  /** Force a re-render (e.g. after a setting change). */
  render() {
    const limit = Math.max(0, this.opts.getDailyLimit());
    const snap = this.store.snapshot(limit);
    const used = snap.window_24h.total_tokens;
    const usedPct  = limit > 0 ? (used / limit) * 100 : 0;

    // The store picks the "most important" snapshot (highest known
    // used_percent across sources, else most recently updated). That's
    // what drives the status-bar item. The tooltip lists every source.
    const rl = snap.rate_limits;
    const primary = rl?.primary ?? null;
    const secondary = rl?.secondary ?? null;
    const worstPct = Math.max(
      primary?.used_percent ?? 0,
      secondary?.used_percent ?? 0,
      usedPct,
    );

    const icon =
      worstPct >= 95          ? "$(error)" :
      worstPct >= 80          ? "$(warning)" :
      limit === 0 && !rl      ? "$(pulse)"  :
                                "$(graph)";

    let text: string;
    if (primary && secondary) {
      text = `${icon} ${shortWindow(primary)} · ${shortWindow(secondary)}`;
    } else if (primary) {
      text = `${icon} ${primary.label} ${shortWindow(primary)}`;
    } else if (limit > 0) {
      text = `${icon} ${fmt(used)} / ${fmt(limit)}`;
    } else {
      text = `${icon} ${fmt(used)} tokens (24h)`;
    }
    this.item.text = text;

    const delta = snap.this_week.total_tokens - snap.last_week.total_tokens;
    const deltaStr =
      snap.last_week.total_tokens === 0
        ? "—"
        : `${delta >= 0 ? "+" : ""}${((delta / Math.max(1, snap.last_week.total_tokens)) * 100).toFixed(1)}%`;

    const sourceLines: string[] = [];
    for (const src of Object.values(snap.rate_limits_by_source)) {
      const tag = src.authoritative ? "" : " _(observed)_";
      const header = `- **${src.source}**${src.plan ? ` \`${src.plan}\`` : ""}${tag}`;
      sourceLines.push(header);
      for (const w of [src.primary, src.secondary]) {
        if (!w) continue;
        sourceLines.push(`  - ${formatWindowLine(w)}`);
      }
    }

    const md = new vscode.MarkdownString(
      [
        `**Token Tracker** — local only`,
        ``,
        ...sourceLines,
        ...(sourceLines.length ? [``] : []),
        limit > 0
          ? `- 24h tokens: \`${used.toLocaleString()}\` / \`${limit.toLocaleString()}\` (${usedPct.toFixed(1)}%)`
          : `- 24h tokens: \`${used.toLocaleString()}\``,
        `- cost 24h: \`$${snap.window_24h.cost_usd.toFixed(4)}\``,
        `- events 24h: \`${snap.window_24h.event_count}\``,
        `- this week: \`${snap.this_week.total_tokens.toLocaleString()}\` vs last \`${snap.last_week.total_tokens.toLocaleString()}\` (${deltaStr})`,
        ``,
        `[Open sidebar](command:tokenTracker.focusSidebar) · [Open full dashboard](command:tokenTracker.openDashboard)`,
      ].join("\n"),
      true,
    );
    md.isTrusted = true;
    this.item.tooltip = md;

    this.item.backgroundColor =
      worstPct >= 95
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : worstPct >= 80
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  }

  dispose() {
    clearInterval(this.tick);
    this.sub.dispose();
    this.item.dispose();
  }
}

function fmt(n: number): string {
  if (n < 1_000)     return n.toString();
  if (n < 1_000_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0) + "K";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
}

/** Compact string for the status-bar text itself — percent if we have one, else observed tokens. */
function shortWindow(w: RateLimitWindow): string {
  // Keep short labels whole ("5h", "7d"), abbreviate long ones to first letter.
  const tag = w.label.length <= 3 ? w.label : (w.label[0] ?? "?");
  if (w.used_percent != null) return `${tag} ${w.used_percent.toFixed(0)}%`;
  if (typeof w.used_tokens === "number") return `${tag} ${fmt(w.used_tokens)}`;
  if (typeof w.used_messages === "number") return `${tag} ${w.used_messages}msg`;
  return tag;
}

/** Tooltip line: percent when known, else raw counts; always include a resets-in footer when present. */
function formatWindowLine(w: RateLimitWindow): string {
  const parts: string[] = [`${w.label}:`];
  if (w.used_percent != null) parts.push(`\`${w.used_percent.toFixed(1)}%\``);
  const observed: string[] = [];
  if (typeof w.used_tokens === "number")   observed.push(`${w.used_tokens.toLocaleString()} tok`);
  if (typeof w.used_messages === "number") observed.push(`${w.used_messages} msg`);
  if (observed.length) parts.push(observed.join(" · "));
  if (w.resets_at > 0) parts.push(`· resets in ${formatEta(w.resets_at)}`);
  return parts.join(" ");
}

function formatEta(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "—";
  const ms = unixSeconds * 1000 - Date.now();
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60000);
  const days  = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins  = totalMin - days * 60 * 24 - hours * 60;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
