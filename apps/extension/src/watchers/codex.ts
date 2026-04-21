import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RateLimitWindow, RateLimitsSnapshot } from "../shared";
import type { EventStore } from "../store";

/**
 * Watches ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl and records both:
 *
 *   1. per-turn usage (`last_token_usage`) as OpenAI events in the EventStore
 *   2. the most recent `rate_limits` block, surfaced in the snapshot for the
 *      sidebar's session/weekly bars
 *
 * Each `event_msg` row looks like:
 *   {
 *     "timestamp": "2026-04-17T21:29:14.909Z",
 *     "type": "event_msg",
 *     "payload": {
 *       "type": "token_count",
 *       "info": {
 *         "last_token_usage":  { "input_tokens": …, "cached_input_tokens": …, "output_tokens": …, "reasoning_output_tokens": …, "total_tokens": … },
 *         "total_token_usage": { … },
 *         "model_context_window": …
 *       },
 *       "rate_limits": {
 *         "limit_id": "codex",
 *         "primary":   { "used_percent": 98.0, "window_minutes": 10080, "resets_at": 1776731102 } | null,
 *         "secondary": { … } | null,
 *         "plan_type": "free" | "plus" | …
 *       }
 *     }
 *   }
 *
 * Dedupe uses `<rolloutBasename>:<timestamp>` as `client_event_id` so re-reading
 * a tail doesn't double-count. Per-file byte offsets are persisted so we skip
 * what we've already seen across reloads.
 */

const OFFSET_STATE_KEY = "tokenTracker.codex.offsets.v1";
const POLL_MS = 2000;
const BACKFILL_DAYS = 7;

interface OffsetMap {
  [absPath: string]: { size: number; mtimeMs: number };
}

/**
 * Cache the `cwd` from each rollout's `session_meta` row so per-turn
 * `event_msg` rows can be tagged with the project they belong to.
 * Keyed by rollout basename (not abs path) to match `client_event_id` keying.
 */
interface CwdMap {
  [rolloutBasename: string]: string;
}

export class CodexWatcher implements vscode.Disposable {
  private readonly root = path.join(os.homedir(), ".codex", "sessions");
  private offsets: OffsetMap = {};
  private cwdByRollout: CwdMap = {};
  private timer: NodeJS.Timeout | null = null;
  private dirWatcher: fs.FSWatcher | null = null;
  private disposed = false;
  private rescanScheduled = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: EventStore,
  ) {}

  async start(): Promise<void> {
    if (!(await exists(this.root))) {
      return;
    }
    this.offsets = this.ctx.globalState.get<OffsetMap>(OFFSET_STATE_KEY, {});

    await this.scanAll({ backfillIfNew: true });

    try {
      this.dirWatcher = fs.watch(this.root, { recursive: true }, (_ev, filename) => {
        if (!filename || !String(filename).endsWith(".jsonl")) return;
        this.scheduleRescan();
      });
      this.dirWatcher.on("error", () => { /* polling fallback still runs */ });
    } catch {
      // some platforms don't support recursive watches; polling fills the gap.
    }

    this.timer = setInterval(() => {
      void this.scanAll({ backfillIfNew: false });
    }, POLL_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.dirWatcher) this.dirWatcher.close();
    void this.ctx.globalState.update(OFFSET_STATE_KEY, this.offsets);
  }

  private scheduleRescan(): void {
    if (this.rescanScheduled) return;
    this.rescanScheduled = true;
    setTimeout(() => {
      this.rescanScheduled = false;
      void this.scanAll({ backfillIfNew: false });
    }, 250);
  }

  private async scanAll(opts: { backfillIfNew: boolean }): Promise<void> {
    if (this.disposed) return;
    const files = await listJsonlFiles(this.root);
    let sawRateLimitsInTail = false;

    const backfillCutoff = Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;

    // sort so we end on the newest file — its final rate_limits wins.
    files.sort();

    for (const file of files) {
      try {
        const st = await fs.promises.stat(file);
        const known = this.offsets[file];
        let startAt = 0;
        if (known) {
          startAt = st.size >= known.size ? known.size : 0;
        } else if (opts.backfillIfNew) {
          startAt = st.mtimeMs < backfillCutoff ? st.size : 0;
        } else {
          startAt = st.size;
        }
        // `session_meta` with `cwd` lives at the top of each rollout. If the
        // scan is going to skip it (because we're resuming mid-file) seed the
        // per-rollout cwd cache from the head so later event_msg rows can be
        // tagged with the right project.
        const base = path.basename(file);
        if (startAt > 0 && !this.cwdByRollout[base]) {
          const sniffed = await sniffCwd(file);
          if (sniffed) this.cwdByRollout[base] = sniffed;
        }
        if (startAt >= st.size) {
          this.offsets[file] = { size: st.size, mtimeMs: st.mtimeMs };
          continue;
        }
        const hadRateLimits = await this.ingestTail(file, startAt, st.size);
        if (hadRateLimits) sawRateLimitsInTail = true;
        this.offsets[file] = { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        // file could have been rotated/deleted between listing and stat; ignore.
      }
    }

    await this.ctx.globalState.update(OFFSET_STATE_KEY, this.offsets);

    // Fallback: if Codex rows don't contain authoritative rate_limits metadata
    // (older/newer formats or sparse rows), publish the same observed 5h/7d
    // snapshot style as Claude so UI still has codex source bars.
    if (!sawRateLimitsInTail) {
      const snap = this.store.snapshot(0).rate_limits_by_source["codex"];
      if (!snap || !snap.authoritative) {
        this.publishDerivedRateLimits();
      }
    }
  }

  private async ingestTail(file: string, startAt: number, endAt: number): Promise<boolean> {
    const length = endAt - startAt;
    if (length <= 0) return false;

    const buf = Buffer.alloc(length);
    const fd = await fs.promises.open(file, "r");
    try {
      await fd.read(buf, 0, length, startAt);
    } finally {
      await fd.close();
    }

    const text = buf.toString("utf8");
    const lines = text.split("\n");
    const startIdx = startAt > 0 ? 1 : 0;
    const base = path.basename(file);
    let sawRateLimits = false;

    for (let i = startIdx; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      if (!line) continue;
      try {
        const hadRateLimits = await this.maybeRecord(base, JSON.parse(line));
        if (hadRateLimits) sawRateLimits = true;
      } catch {
        // malformed line — skip.
      }
    }
    return sawRateLimits;
  }

  private async maybeRecord(basename: string, row: unknown): Promise<boolean> {
    if (!row || typeof row !== "object") return false;
    const r = row as {
      timestamp?: string;
      type?: string;
      payload?: {
        type?: string;
        cwd?: string;
        info?: {
          last_token_usage?: {
            input_tokens?: number;
            cached_input_tokens?: number;
            output_tokens?: number;
            reasoning_output_tokens?: number;
            total_tokens?: number;
          } | null;
        } | null;
        rate_limits?: {
          primary?: RawWindow | null;
          secondary?: RawWindow | null;
          plan_type?: string | null;
        } | null;
      };
    };

    if (r.type === "session_meta" && typeof r.payload?.cwd === "string" && r.payload.cwd) {
      this.cwdByRollout[basename] = r.payload.cwd;
      return false;
    }

    if (r.type !== "event_msg" || r.payload?.type !== "token_count") return false;

    // 1) rate_limits — always update if present (most recent line wins because
    //    files are scanned oldest→newest and tail reads are in-order). When
    //    the CLI gives us a real used_percent + window_minutes we enrich the
    //    window with locally-observed tokens/messages over that exact span,
    //    so the UI can render "83% · 142K tok · 67 msgs" in one row.
    const rl = r.payload?.rate_limits;
    if (rl) {
      const nowMs = Date.now();
      const primary = toWindow(rl.primary, "Session");
      const secondary = toWindow(rl.secondary, "Weekly");
      if (primary)   enrichWithObserved(primary,   this.store, nowMs);
      if (secondary) enrichWithObserved(secondary, this.store, nowMs);

      const snap: RateLimitsSnapshot = {
        source: "codex",
        plan: rl.plan_type ?? null,
        authoritative: true,
        primary,
        secondary,
        updated_at: r.timestamp ?? new Date().toISOString(),
      };
      // if there's only one window and it spans 7 days, relabel it as weekly.
      if (snap.primary && !snap.secondary && snap.primary.window_minutes >= 60 * 24 * 6) {
        snap.primary = { ...snap.primary, label: "Weekly" };
      }
      this.store.updateRateLimits(snap);
    }

    // 2) per-turn usage.
    const usage = r.payload?.info?.last_token_usage;
    if (!usage) return Boolean(rl);

    const input_tokens  = num(usage.input_tokens);
    const cached_tokens = num(usage.cached_input_tokens);
    const output_tokens =
      num(usage.output_tokens) + num(usage.reasoning_output_tokens);

    if (input_tokens === 0 && output_tokens === 0 && cached_tokens === 0) {
      return Boolean(rl);
    }

    await this.store.record({
      provider: "openai",
      // Codex rollouts don't name the exact model per turn in this event;
      // use a stable source tag so it groups cleanly in the dashboard.
      model: "codex",
      input_tokens,
      output_tokens,
      cached_tokens: cached_tokens > 0 ? cached_tokens : undefined,
      source: "codex",
      project: this.cwdByRollout[basename] ?? null,
      client_event_id: r.timestamp ? `${basename}:${r.timestamp}` : undefined,
      occurred_at: r.timestamp,
    });
    return Boolean(rl);
  }

  private publishDerivedRateLimits(): void {
    const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const w5h = this.store.aggregateSourceWindow("codex", FIVE_HOURS_MS, now);
    const w7d = this.store.aggregateSourceWindow("codex", SEVEN_DAYS_MS, now);

    this.store.updateRateLimits({
      source: "codex",
      plan: null,
      authoritative: false,
      primary: {
        label: "5h",
        used_percent: null,
        used_tokens: w5h.tokens,
        used_messages: w5h.messages,
        window_minutes: 300,
        resets_at: 0,
      },
      secondary: {
        label: "7d",
        used_percent: null,
        used_tokens: w7d.tokens,
        used_messages: w7d.messages,
        window_minutes: 60 * 24 * 7,
        resets_at: 0,
      },
      updated_at: new Date(now).toISOString(),
    });
  }
}

interface RawWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

function toWindow(w: RawWindow | null | undefined, fallbackLabel: string): RateLimitWindow | null {
  if (!w || typeof w !== "object") return null;
  const used = Number(w.used_percent);
  const windowMin = Number(w.window_minutes);
  const resetsAt = Number(w.resets_at);
  if (!Number.isFinite(used) || !Number.isFinite(windowMin)) return null;
  // Relabel by window size so UI is self-describing regardless of plan shape.
  const label =
    windowMin >= 60 * 24 * 6 ? "Weekly" :
    windowMin >= 60 * 20     ? "Daily"  :
    windowMin >= 60          ? "Session" :
                               fallbackLabel;
  return {
    label,
    used_percent: Math.max(0, Math.min(100, used)),
    window_minutes: Math.max(0, windowMin),
    resets_at: Number.isFinite(resetsAt) ? resetsAt : 0,
  };
}

/**
 * Fill `used_tokens` / `used_messages` on a Codex window using locally-ingested
 * events over the same `window_minutes` span. Leaves `used_percent` untouched
 * (still authoritative from the CLI).
 */
function enrichWithObserved(
  w: RateLimitWindow,
  store: EventStore,
  nowMs: number,
): void {
  if (w.window_minutes <= 0) return;
  const agg = store.aggregateSourceWindow("codex", w.window_minutes * 60 * 1000, nowMs);
  w.used_tokens = agg.tokens;
  w.used_messages = agg.messages;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Read up to 64KB from the start of a rollout file and return the `cwd` from
 * the first `session_meta` row we find. Rollouts written by `codex-tui` put
 * that row on line 1, so this is bounded and fast. Returns `null` if nothing
 * usable is there (corrupt file, future format, etc).
 */
async function sniffCwd(file: string): Promise<string | null> {
  const MAX = 64 * 1024;
  let fd: fs.promises.FileHandle | null = null;
  try {
    fd = await fs.promises.open(file, "r");
    const st = await fd.stat();
    const length = Math.min(MAX, st.size);
    if (length <= 0) return null;
    const buf = Buffer.alloc(length);
    await fd.read(buf, 0, length, 0);
    const text = buf.toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as {
          type?: string;
          payload?: { cwd?: string };
        };
        if (obj?.type === "session_meta" && typeof obj.payload?.cwd === "string" && obj.payload.cwd) {
          return obj.payload.cwd;
        }
      } catch {
        // partial line on a sniff boundary — stop; the meta row is always first.
        break;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd) await fd.close().catch(() => undefined);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}
