import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type {
  AggregateWindow,
  DailyBucket,
  IngestEvent,
  LlmProvider,
  ProviderBreakdown,
  UsageEvent,
  UsageSnapshot,
} from "@token-tracker/shared";
import { estimateCostUSD } from "@token-tracker/shared";

/** File in globalStorageUri where events are persisted as newline-delimited JSON. */
const EVENTS_FILE = "events.ndjson";

/**
 * Events older than this are dropped on the next compaction.
 * 60 days is enough for a rolling 7-day weekly comparison + a little margin.
 */
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * In-memory + file-backed store of usage events.
 *
 * Intentionally small and self-contained:
 *   - no external DB
 *   - no network calls
 *   - survives reloads via a single JSON-lines file under globalStorageUri
 */
export class EventStore {
  private events: UsageEvent[] = [];
  private dedupe = new Set<string>();
  private readonly file: vscode.Uri;
  private readonly listeners = new Set<() => void>();
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly ctx: vscode.ExtensionContext) {
    this.file = vscode.Uri.joinPath(ctx.globalStorageUri, EVENTS_FILE);
  }

  static async open(ctx: vscode.ExtensionContext): Promise<EventStore> {
    const store = new EventStore(ctx);
    await store.load();
    return store;
  }

  onChange(fn: () => void): vscode.Disposable {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  /** Accepts a raw inbound event, normalizes it, persists it, emits change. */
  async record(raw: IngestEvent & { source?: string }): Promise<UsageEvent | null> {
    const input_tokens  = clampInt(raw.input_tokens);
    const output_tokens = clampInt(raw.output_tokens);
    const cached_tokens = clampInt(raw.cached_tokens ?? 0);
    const total_tokens  = input_tokens + output_tokens + cached_tokens;
    const cost_usd =
      raw.cost_usd != null && Number.isFinite(raw.cost_usd)
        ? Math.max(0, raw.cost_usd)
        : estimateCostUSD(raw.provider, raw.model, input_tokens, output_tokens, cached_tokens);

    const client_event_id = raw.client_event_id?.trim() || null;
    if (client_event_id && this.dedupe.has(client_event_id)) return null;

    const ev: UsageEvent = {
      id: randomUUID(),
      provider: raw.provider,
      model: String(raw.model),
      input_tokens,
      output_tokens,
      cached_tokens,
      total_tokens,
      cost_usd,
      source: raw.source ?? "extension",
      occurred_at: raw.occurred_at ?? new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      client_event_id,
    };

    this.events.push(ev);
    if (client_event_id) this.dedupe.add(client_event_id);
    await this.append(ev);
    this.emit();
    return ev;
  }

  /** Drop everything. */
  async clear(): Promise<void> {
    this.events = [];
    this.dedupe.clear();
    await this.rewrite();
    this.emit();
  }

  all(): readonly UsageEvent[] {
    return this.events;
  }

  exportJson(): string {
    return JSON.stringify(this.events, null, 2);
  }

  /** Compute everything the status bar + webview need. */
  snapshot(dailyLimit: number): UsageSnapshot {
    const now = Date.now();
    const cutoff24 = now - 24 * 60 * 60 * 1000;

    const window_24h = emptyAgg();
    const by_provider: Record<string, AggregateWindow> = {};
    const recent: UsageEvent[] = [];

    for (const ev of this.events) {
      const t = Date.parse(ev.occurred_at);
      if (!Number.isFinite(t)) continue;
      if (t >= cutoff24) {
        addTo(window_24h, ev);
        const key = ev.provider;
        const bucket = by_provider[key] ?? (by_provider[key] = emptyAgg());
        addTo(bucket, ev);
        recent.push(ev);
      }
    }

    recent.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

    return {
      daily_limit: dailyLimit,
      window_24h,
      this_week: this.aggregateWeek(0),
      last_week: this.aggregateWeek(1),
      last_7_days: this.last7Days(),
      by_provider_24h: Object.entries(by_provider)
        .map(([provider, agg]): ProviderBreakdown => ({
          provider: provider as LlmProvider,
          ...agg,
        }))
        .sort((a, b) => b.total_tokens - a.total_tokens),
      recent: recent.slice(0, 25),
    };
  }

  // ---------- internals ----------

  private emit() {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* swallow */ }
    }
  }

  private aggregateWeek(offsetWeeks: number): AggregateWindow {
    const now = new Date();
    const startOfThisWeek = startOfIsoWeek(now);
    const start = new Date(startOfThisWeek.getTime() - offsetWeeks * 7 * 24 * 60 * 60 * 1000);
    const end   = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const agg = emptyAgg();
    for (const ev of this.events) {
      const t = Date.parse(ev.occurred_at);
      if (t >= start.getTime() && t < end.getTime()) addTo(agg, ev);
    }
    return agg;
  }

  private last7Days(): DailyBucket[] {
    const buckets = new Map<string, DailyBucket>();
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = isoDay(d);
      buckets.set(key, { day: key, ...emptyAgg() });
    }
    for (const ev of this.events) {
      const t = Date.parse(ev.occurred_at);
      if (!Number.isFinite(t)) continue;
      const key = isoDay(new Date(t));
      const bucket = buckets.get(key);
      if (bucket) addTo(bucket, ev);
    }
    return [...buckets.values()];
  }

  private async load(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.ctx.globalStorageUri);
    } catch { /* already exists */ }

    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(this.file);
    } catch {
      return; // first run
    }

    const text = Buffer.from(raw).toString("utf8");
    const cutoff = Date.now() - RETENTION_MS;
    const kept: UsageEvent[] = [];
    let needsCompact = false;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as UsageEvent;
        if (!ev?.occurred_at) { needsCompact = true; continue; }
        const t = Date.parse(ev.occurred_at);
        if (!Number.isFinite(t) || t < cutoff) { needsCompact = true; continue; }
        kept.push(ev);
        if (ev.client_event_id) this.dedupe.add(ev.client_event_id);
      } catch {
        needsCompact = true;
      }
    }

    this.events = kept;
    if (needsCompact) await this.rewrite();
  }

  /** Serialize file writes so appends never interleave. */
  private queue(op: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(op, op);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private append(ev: UsageEvent): Promise<void> {
    return this.queue(async () => {
      const line = Buffer.from(JSON.stringify(ev) + "\n", "utf8");
      let current: Uint8Array;
      try {
        current = await vscode.workspace.fs.readFile(this.file);
      } catch {
        current = new Uint8Array();
      }
      const merged = Buffer.concat([Buffer.from(current), line]);
      await vscode.workspace.fs.writeFile(this.file, merged);
    });
  }

  private rewrite(): Promise<void> {
    return this.queue(async () => {
      const body = this.events.map((e) => JSON.stringify(e)).join("\n");
      const bytes = Buffer.from(body.length ? body + "\n" : "", "utf8");
      await vscode.workspace.fs.writeFile(this.file, bytes);
    });
  }
}

// ---------- helpers ----------

function clampInt(n: unknown): number {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

function emptyAgg(): AggregateWindow {
  return {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    cost_usd: 0,
    event_count: 0,
  };
}

function addTo(agg: AggregateWindow, ev: UsageEvent) {
  agg.total_tokens  += ev.total_tokens;
  agg.input_tokens  += ev.input_tokens;
  agg.output_tokens += ev.output_tokens;
  agg.cached_tokens += ev.cached_tokens;
  agg.cost_usd      += ev.cost_usd;
  agg.event_count   += 1;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday 00:00 local time for the ISO week containing `d`. */
function startOfIsoWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}
