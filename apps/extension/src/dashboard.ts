import * as vscode from "vscode";
import type { EventStore } from "./store";
import type { UsageSnapshot } from "@token-tracker/shared";

/**
 * A tiny single-panel dashboard rendered in a VS Code webview.
 * Shows the 24-hour meter, weekly comparison, per-provider breakdown,
 * and a live feed of recent events — all sourced from the local store.
 */
export class DashboardPanel {
  private static current: DashboardPanel | null = null;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly store: EventStore,
    private readonly getDailyLimit: () => number,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "tokenTracker.dashboard",
      "Token Tracker",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.disposables.push(this.store.onChange(() => this.refresh()));

    this.refresh();
  }

  static show(store: EventStore, getDailyLimit: () => number) {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      DashboardPanel.current.refresh();
      return;
    }
    DashboardPanel.current = new DashboardPanel(store, getDailyLimit);
  }

  private refresh() {
    const snap = this.store.snapshot(Math.max(0, this.getDailyLimit()));
    this.panel.webview.html = renderDashboardHtml(snap, { layout: "full" });
  }

  private dispose() {
    DashboardPanel.current = null;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
    this.panel.dispose();
  }
}

export interface RenderOptions {
  layout: "full" | "compact";
}

export function renderDashboardHtml(
  snap: UsageSnapshot,
  opts: RenderOptions = { layout: "full" },
): string {
  const compact = opts.layout === "compact";
  const pct =
    snap.daily_limit > 0
      ? Math.min(100, (snap.window_24h.total_tokens / snap.daily_limit) * 100)
      : 0;

  const meterColor =
    pct >= 95 ? "var(--vscode-statusBarItem-errorBackground)" :
    pct >= 80 ? "var(--vscode-statusBarItem-warningBackground)" :
                "var(--vscode-progressBar-background)";

  const weeklyDelta = snap.this_week.total_tokens - snap.last_week.total_tokens;
  const weeklyPct =
    snap.last_week.total_tokens === 0
      ? null
      : (weeklyDelta / Math.max(1, snap.last_week.total_tokens)) * 100;

  const maxDay = Math.max(1, ...snap.last_7_days.map((b) => b.total_tokens));

  const dayBars = snap.last_7_days
    .map((b) => {
      const h = Math.round((b.total_tokens / maxDay) * 100);
      return `
      <div class="day">
        <div class="bar-track">
          <div class="bar-fill" style="height:${h}%" title="${esc(b.day)}: ${b.total_tokens.toLocaleString()} tokens"></div>
        </div>
        <div class="day-label">${esc(b.day.slice(5))}</div>
      </div>`;
    })
    .join("");

  const providers = compact ? snap.by_provider_24h.slice(0, 4) : snap.by_provider_24h;
  const providerRows = providers
    .map((p) => {
      const share = snap.window_24h.total_tokens > 0
        ? (p.total_tokens / snap.window_24h.total_tokens) * 100
        : 0;
      if (compact) {
        return `
      <tr>
        <td>${esc(p.provider)}</td>
        <td class="num">${p.total_tokens.toLocaleString()}</td>
        <td class="num">${share.toFixed(0)}%</td>
      </tr>`;
      }
      return `
      <tr>
        <td>${esc(p.provider)}</td>
        <td class="num">${p.event_count}</td>
        <td class="num">${p.total_tokens.toLocaleString()}</td>
        <td class="num">$${p.cost_usd.toFixed(4)}</td>
        <td class="num">${share.toFixed(1)}%</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="${compact ? 3 : 5}" class="muted">No events in the last 24 hours.</td></tr>`;

  const recent = compact ? snap.recent.slice(0, 8) : snap.recent;
  const feedRows = recent
    .map((ev) => {
      const when = new Date(ev.occurred_at);
      if (compact) {
        return `
      <tr>
        <td class="muted">${esc(when.toLocaleTimeString())}</td>
        <td class="mono">${esc(ev.provider)}</td>
        <td class="num">${ev.total_tokens.toLocaleString()}</td>
      </tr>`;
      }
      return `
      <tr>
        <td class="muted">${esc(when.toLocaleTimeString())}</td>
        <td>${esc(ev.provider)}</td>
        <td class="mono">${esc(ev.model)}</td>
        <td class="num">${ev.input_tokens.toLocaleString()}</td>
        <td class="num">${ev.output_tokens.toLocaleString()}</td>
        <td class="num">${ev.total_tokens.toLocaleString()}</td>
        <td class="num">$${ev.cost_usd.toFixed(4)}</td>
        <td class="muted">${esc(ev.source)}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="${compact ? 3 : 8}" class="muted">Waiting for events… POST to http://127.0.0.1 to add one.</td></tr>`;

  return /* html */ `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: ${compact ? "10px 12px" : "24px"};
      ${compact ? "" : "max-width: 1000px; margin: 0 auto;"}
    }
    h1 { font-size: ${compact ? "13px" : "18px"}; margin: 0 0 4px; }
    h2 { font-size: ${compact ? "10px" : "13px"}; margin: ${compact ? "16px 0 6px" : "24px 0 8px"}; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: ${compact ? "12px" : "24px"}; font-size: ${compact ? "10px" : "12px"}; }
    .grid { display: grid; grid-template-columns: ${compact ? "1fr" : "repeat(3, minmax(0, 1fr))"}; gap: ${compact ? "8px" : "16px"}; margin-bottom: 8px; }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: ${compact ? "10px 12px" : "16px"};
      background: var(--vscode-editor-background);
    }
    .card .label { font-size: ${compact ? "9px" : "11px"}; text-transform: uppercase; color: var(--vscode-descriptionForeground); letter-spacing: 0.05em; }
    .card .value { font-size: ${compact ? "18px" : "24px"}; font-weight: 600; margin-top: 2px; }
    .card .sub   { font-size: ${compact ? "10px" : "11px"}; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .meter { height: 10px; background: var(--vscode-editorWidget-background); border-radius: 5px; overflow: hidden; margin-top: 10px; }
    .meter-fill { height: 100%; background: ${meterColor}; transition: width .3s ease; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
    th { color: var(--vscode-descriptionForeground); font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: var(--vscode-editor-font-family); }
    .muted { color: var(--vscode-descriptionForeground); }
    .bars { display: flex; gap: ${compact ? "3px" : "6px"}; align-items: flex-end; height: ${compact ? "80px" : "120px"}; margin-top: 8px; }
    .day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
    .bar-track { height: ${compact ? "60px" : "100px"}; width: 100%; background: var(--vscode-editorWidget-background); border-radius: 3px; display: flex; align-items: flex-end; overflow: hidden; }
    .bar-fill  { width: 100%; background: var(--vscode-charts-blue, #3b82f6); border-radius: 3px 3px 0 0; min-height: 2px; }
    .day-label { font-size: 10px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .delta-up   { color: var(--vscode-errorForeground); }
    .delta-down { color: var(--vscode-charts-green, #22c55e); }
  </style>
</head>
<body>
  <h1>Token Tracker</h1>
  <div class="subtitle">Local usage — nothing leaves this machine.</div>

  <div class="grid">
    <div class="card">
      <div class="label">Last 24 hours</div>
      <div class="value">${snap.window_24h.total_tokens.toLocaleString()}</div>
      <div class="sub">${
        snap.daily_limit > 0
          ? `of ${snap.daily_limit.toLocaleString()} (${pct.toFixed(1)}%)`
          : `tokens · set <code>tokenTracker.dailyTokenLimit</code> to show a meter`
      }</div>
      <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="card">
      <div class="label">24h cost</div>
      <div class="value">$${snap.window_24h.cost_usd.toFixed(4)}</div>
      <div class="sub">${snap.window_24h.event_count} events</div>
    </div>
    <div class="card">
      <div class="label">This week vs last</div>
      <div class="value">${snap.this_week.total_tokens.toLocaleString()}</div>
      <div class="sub">
        vs ${snap.last_week.total_tokens.toLocaleString()} last week
        ${
          weeklyPct === null
            ? ""
            : `<span class="${weeklyDelta >= 0 ? "delta-up" : "delta-down"}">
                 ${weeklyDelta >= 0 ? "+" : ""}${weeklyPct.toFixed(1)}%
               </span>`
        }
      </div>
    </div>
  </div>

  <h2>Last 7 days</h2>
  <div class="bars">${dayBars}</div>

  <h2>By provider (24h)</h2>
  <table>
    <thead><tr>${
      compact
        ? `<th>Provider</th><th class="num">Tokens</th><th class="num">Share</th>`
        : `<th>Provider</th><th class="num">Events</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Share</th>`
    }</tr></thead>
    <tbody>${providerRows}</tbody>
  </table>

  <h2>Recent events</h2>
  <table>
    <thead><tr>${
      compact
        ? `<th>Time</th><th>Provider</th><th class="num">Tokens</th>`
        : `<th>Time</th><th>Provider</th><th>Model</th>
           <th class="num">In</th><th class="num">Out</th><th class="num">Total</th>
           <th class="num">Cost</th><th>Source</th>`
    }</tr></thead>
    <tbody>${feedRows}</tbody>
  </table>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "\"" ? "&quot;" : "&#39;",
  );
}
