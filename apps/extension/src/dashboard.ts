import * as vscode from "vscode";
import type { EventStore } from "./store";
import type {
  ProjectBreakdown,
  RateLimitsSnapshot,
  RateLimitWindow,
  UsageSnapshot,
} from "./shared";

export interface SourceDailyLimits {
  "claude-code": number;
  codex: number;
}

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
    private readonly getSourceDailyLimits: () => SourceDailyLimits,
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

  static show(
    store: EventStore,
    getDailyLimit: () => number,
    getSourceDailyLimits: () => SourceDailyLimits,
  ) {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      DashboardPanel.current.refresh();
      return;
    }
    DashboardPanel.current = new DashboardPanel(store, getDailyLimit, getSourceDailyLimits);
  }

  private refresh() {
    const snap = this.store.snapshot(Math.max(0, this.getDailyLimit()));
    this.panel.webview.html = renderDashboardHtml(snap, {
      layout: "full",
      sourceDailyLimits: this.getSourceDailyLimits(),
    });
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
  sourceDailyLimits: SourceDailyLimits;
}

export function renderDashboardHtml(
  snap: UsageSnapshot,
  opts: RenderOptions = {
    layout: "full",
    sourceDailyLimits: { "claude-code": 1_000_000, codex: 1_000_000 },
  },
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

  const sourceBars = renderSourceDailyBars(snap, opts.sourceDailyLimits, compact);
  const rateBars = renderRateBars(snap, compact);
  const projectSection = renderProjectSection(snap.by_project_24h, compact);

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
    .rate-wrap {
      display: flex;
      gap: ${compact ? "10px" : "18px"};
      align-items: center;
      flex-wrap: wrap;
      padding: ${compact ? "8px 0 10px" : "6px 0 18px"};
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: ${compact ? "10px" : "18px"};
      font-size: ${compact ? "11px" : "12px"};
    }
    .rate-row { display: flex; align-items: center; gap: 8px; flex: 1 1 200px; min-width: 0; }
    .rate-label { color: var(--vscode-descriptionForeground); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rate-track {
      position: relative;
      flex: 1 1 auto;
      min-width: 80px;
      height: ${compact ? "10px" : "12px"};
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      overflow: hidden;
    }
    .rate-fill {
      position: absolute; inset: 0 auto 0 0;
      background: var(--vscode-charts-blue, #3b82f6);
      transition: width .3s ease;
    }
    .rate-fill.warn  { background: var(--vscode-charts-yellow, #eab308); }
    .rate-fill.error { background: var(--vscode-charts-red,    #ef4444); }
    .rate-cap {
      position: absolute; top: -1px; bottom: -1px; right: -1px;
      width: 2px; background: var(--vscode-foreground); opacity: .45;
    }
    .rate-reset { color: var(--vscode-descriptionForeground); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rate-empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    .rate-source {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 0; border-top: 1px solid var(--vscode-panel-border);
    }
    .rate-source:first-child { border-top: 0; }
    .rate-source-name {
      font-weight: 600; font-size: ${compact ? "11px" : "12px"};
      min-width: ${compact ? "90px" : "110px"};
    }
    .rate-source-plan { color: var(--vscode-descriptionForeground); font-weight: normal; margin-left: 6px; }
    .rate-source-tag  { color: var(--vscode-descriptionForeground); font-size: 10px; font-style: italic; margin-left: 6px; }
    .rate-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 8px; border-radius: 12px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      font-variant-numeric: tabular-nums;
      font-size: ${compact ? "10px" : "11px"};
    }
    .rate-pill-label { color: var(--vscode-descriptionForeground); }
    .rate-wrap.stacked { flex-direction: column; align-items: stretch; gap: 0; }
    .source-wrap {
      display: flex;
      flex-direction: column;
      gap: ${compact ? "8px" : "10px"};
      margin: 0 0 ${compact ? "10px" : "16px"};
    }
    .source-row {
      display: grid;
      grid-template-columns: ${compact ? "80px 1fr auto" : "100px 1fr auto"};
      gap: 8px;
      align-items: center;
      font-size: ${compact ? "11px" : "12px"};
    }
    .source-name {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .source-track {
      height: ${compact ? "10px" : "12px"};
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background);
      overflow: hidden;
    }
    .source-fill {
      height: 100%;
      background: var(--vscode-charts-blue, #3b82f6);
      transition: width .3s ease;
    }
    .source-fill.warn  { background: var(--vscode-charts-yellow, #eab308); }
    .source-fill.error { background: var(--vscode-charts-red,    #ef4444); }
    .source-value {
      font-variant-numeric: tabular-nums;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
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
    .project-list {
      display: flex;
      flex-direction: column;
      gap: ${compact ? "8px" : "10px"};
    }
    .project-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      padding: ${compact ? "6px 8px" : "8px 10px"};
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      background: var(--vscode-editor-background);
    }
    .project-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font-size: ${compact ? "11px" : "12px"};
    }
    .project-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .project-total { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .io-bar {
      display: flex;
      width: 100%;
      height: ${compact ? "10px" : "12px"};
      border-radius: 3px;
      overflow: hidden;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .io-bar .io-in  { background: var(--vscode-charts-blue,   #3b82f6); }
    .io-bar .io-out { background: var(--vscode-charts-orange, #f59e0b); }
    .io-legend {
      display: flex;
      gap: 12px;
      font-size: ${compact ? "10px" : "11px"};
      color: var(--vscode-descriptionForeground);
      font-variant-numeric: tabular-nums;
    }
    .io-legend .dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle;
    }
    .io-legend .dot.in  { background: var(--vscode-charts-blue,   #3b82f6); }
    .io-legend .dot.out { background: var(--vscode-charts-orange, #f59e0b); }
  </style>
</head>
<body>
  <h1>Token Tracker</h1>
  <div class="subtitle">Local usage — nothing leaves this machine.</div>

  ${sourceBars}
  ${rateBars}

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

  ${projectSection}

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

/**
 * Render the "By project (24h)" card. Each row shows the project name, the
 * total tokens, and a single horizontal bar split into input vs output
 * proportions. Intentionally does not show cost — project attribution is a
 * rough signal (cwd-based), and percentages vs. raw counts read cleanly.
 */
function renderProjectSection(projects: ProjectBreakdown[], compact: boolean): string {
  if (!projects || projects.length === 0) {
    return `
  <h2>By project (24h)</h2>
  <div class="muted" style="font-size:${compact ? "11px" : "12px"}">
    No project-tagged events in the last 24 hours.
  </div>`;
  }

  const visible = compact ? projects.slice(0, 5) : projects.slice(0, 10);
  const rows = visible.map((p) => renderProjectRow(p)).join("");

  return `
  <h2>By project (24h)</h2>
  <div class="io-legend">
    <span><span class="dot in"></span>Input</span>
    <span><span class="dot out"></span>Output</span>
  </div>
  <div class="project-list" style="margin-top:6px">${rows}</div>`;
}

function renderProjectRow(p: ProjectBreakdown): string {
  const io = p.input_tokens + p.output_tokens;
  const inPct = io > 0 ? (p.input_tokens / io) * 100 : 0;
  const outPct = io > 0 ? 100 - inPct : 0;
  const tooltip =
    p.project === "unknown"
      ? "No project tag recorded for these events."
      : p.project;
  const title =
    `${tooltip}\n` +
    `in: ${p.input_tokens.toLocaleString()}  out: ${p.output_tokens.toLocaleString()}` +
    (p.cached_tokens ? `  cached: ${p.cached_tokens.toLocaleString()}` : "");
  return `
    <div class="project-row" title="${esc(title)}">
      <div class="project-head">
        <span class="project-name">${esc(p.label || p.project)}</span>
        <span class="project-total">${p.total_tokens.toLocaleString()} tok · ${p.event_count} evt</span>
      </div>
      <div class="io-bar" aria-label="input vs output tokens">
        <div class="io-in"  style="width:${inPct.toFixed(2)}%"></div>
        <div class="io-out" style="width:${outPct.toFixed(2)}%"></div>
      </div>
      <div class="io-legend">
        <span>In ${p.input_tokens.toLocaleString()} (${inPct.toFixed(0)}%)</span>
        <span>Out ${p.output_tokens.toLocaleString()} (${outPct.toFixed(0)}%)</span>
      </div>
    </div>`;
}

function renderSourceDailyBars(
  snap: UsageSnapshot,
  limits: SourceDailyLimits,
  _compact: boolean,
): string {
  const bySource = new Map(snap.by_source_5h.map((s) => [s.source, s]));
  const claude = bySource.get("claude-code")?.total_tokens ?? 0;
  const codex = bySource.get("codex")?.total_tokens ?? 0;

  const rows = [
    renderSourceDailyRow("Claude", claude, limits["claude-code"]),
    renderSourceDailyRow("Codex", codex, limits.codex),
  ].join("");

  return `<div class="source-wrap"><div class="muted">Rolling window: last 5h</div>${rows}</div>`;
}

function renderSourceDailyRow(name: string, used: number, limit: number): string {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  const cls = pct >= 95 ? "source-fill error" : pct >= 80 ? "source-fill warn" : "source-fill";
  const text = limit > 0
    ? `${formatCount(used)} / ${formatCount(limit)} (${pct.toFixed(1)}%)`
    : `${formatCount(used)} tokens`;
  return `
    <div class="source-row">
      <span class="source-name">${esc(name)}</span>
      <div class="source-track"><div class="${cls}" style="width:${pct}%"></div></div>
      <span class="source-value">${esc(text)}</span>
    </div>`;
}

function renderRateBars(snap: UsageSnapshot, compact: boolean): string {
  const sources = Object.values(snap.rate_limits_by_source);
  if (sources.length === 0) {
    // Fallback: synthesize a daily bar from window_24h / daily_limit so the
    // UI isn't empty on a fresh install.
    if (snap.daily_limit > 0) {
      const used = Math.min(100, (snap.window_24h.total_tokens / snap.daily_limit) * 100);
      const synthetic: RateLimitWindow = {
        label: "Daily",
        used_percent: used,
        window_minutes: 24 * 60,
        resets_at: Math.floor(endOfToday() / 1000),
      };
      return `<div class="rate-wrap">${renderWindow(synthetic)}</div>`;
    }
    return `<div class="rate-wrap"><span class="rate-empty">No rate-limit info yet — start a Codex CLI or Claude Code session to populate this.</span></div>`;
  }

  // Stable order: authoritative sources first (real caps), then derived.
  sources.sort((a, b) => Number(b.authoritative ?? false) - Number(a.authoritative ?? false));
  const sections = sources.map((s) => renderSource(s, compact)).join("");
  return `<div class="rate-wrap stacked">${sections}</div>`;
}

function renderSource(src: RateLimitsSnapshot, _compact: boolean): string {
  const windows: string[] = [];
  if (src.primary)   windows.push(renderWindow(src.primary));
  if (src.secondary) windows.push(renderWindow(src.secondary));
  if (windows.length === 0) {
    windows.push(`<span class="rate-empty">no windows</span>`);
  }
  const tag = src.authoritative ? "" : `<span class="rate-source-tag">observed · no upstream cap</span>`;
  const plan = src.plan ? `<span class="rate-source-plan">${esc(src.plan)}</span>` : "";
  return `
    <div class="rate-source">
      <span class="rate-source-name">${esc(src.source)}${plan}${tag}</span>
      ${windows.join("")}
    </div>`;
}

/** Render either a proportion bar (when a real cap exists) or a count pill. */
function renderWindow(w: RateLimitWindow): string {
  const resetIn = w.resets_at > 0
    ? `resets in ${formatDuration(w.resets_at * 1000 - Date.now())}`
    : "";

  if (w.used_percent != null) {
    const pct = Math.max(0, Math.min(100, w.used_percent));
    const cls = pct >= 95 ? "rate-fill error" : pct >= 80 ? "rate-fill warn" : "rate-fill";
    const observed = formatObserved(w);
    const title = `${w.label} · ${pct.toFixed(1)}% · ${w.window_minutes}m window${observed ? ` · ${observed}` : ""}`;
    return `
      <div class="rate-row" title="${esc(title)}">
        <span class="rate-label">${esc(w.label)}: ${pct.toFixed(1)}%${observed ? ` · ${esc(observed)}` : ""}</span>
        <div class="rate-track">
          <div class="${cls}" style="width:${pct}%"></div>
          <div class="rate-cap"></div>
        </div>
        ${resetIn ? `<span class="rate-reset">${esc(resetIn)}</span>` : ""}
      </div>`;
  }

  // No authoritative cap — render a count pill only.
  const body = formatObserved(w) || "no data";
  const title = `${w.label} · observed in last ${w.window_minutes}m`;
  return `
    <span class="rate-pill" title="${esc(title)}">
      <span class="rate-pill-label">${esc(w.label)}</span>
      <span>${esc(body)}</span>
      ${resetIn ? `<span class="rate-reset">· ${esc(resetIn)}</span>` : ""}
    </span>`;
}

function formatObserved(w: RateLimitWindow): string {
  const parts: string[] = [];
  if (typeof w.used_tokens === "number")   parts.push(`${formatCount(w.used_tokens)} tok`);
  if (typeof w.used_messages === "number") parts.push(`${w.used_messages} msg`);
  return parts.join(" · ");
}

function formatCount(n: number): string {
  if (n < 1_000) return n.toLocaleString();
  if (n < 1_000_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0) + "K";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60000);
  const days  = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins  = totalMin - days * 60 * 24 - hours * 60;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "\"" ? "&quot;" : "&#39;",
  );
}
