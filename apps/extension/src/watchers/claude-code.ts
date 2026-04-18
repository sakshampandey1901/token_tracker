import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { EventStore } from "../store";

/**
 * Watches ~/.claude/projects/<encoded-project>/<session>.jsonl files and
 * records every assistant message as a usage event.
 *
 * Each jsonl row for an assistant message looks like:
 *   {
 *     "type": "assistant",
 *     "uuid": "…",
 *     "timestamp": "2026-04-17T21:39:33.273Z",
 *     "message": {
 *       "model": "claude-opus-4-6",
 *       "usage": {
 *         "input_tokens": 3,
 *         "output_tokens": 99,
 *         "cache_creation_input_tokens": 4485,
 *         "cache_read_input_tokens": 11432
 *       }
 *     }
 *   }
 *
 * The row `uuid` is stable, so it's used as `client_event_id` for dedupe.
 * Per-file byte offsets are persisted so we don't re-ingest across reloads.
 *
 * ---
 * Rate-limit derivation (Option A — observed counts, no inference):
 *
 * Claude Code emits zero authoritative rate-limit / plan / quota fields in
 * local files as of CLI 2.1.87. A full sweep of ~/.claude/projects/**\/*.jsonl
 * plus ~/.claude/*.json surfaced only:
 *   - message.usage.service_tier = "standard"   (constant API tier tag)
 *   - message.content[].input.{plan, limit}      (tool-call arguments)
 *   - snapshot.trackedFileBackups["…rateLimiter.js"]  (user source file)
 *
 * So instead of guessing a cap (which would require inferring a plan from
 * `message.model`, which is explicitly disallowed), after each scan cycle we
 * aggregate the tokens + assistant-row counts we've already ingested over
 * two rolling windows — 5h and 7d — and emit them as a RateLimitsSnapshot
 * with `used_percent: null` and `authoritative: false`. The UI renders these
 * as count pills rather than percentage bars.
 *
 * If Anthropic later ships real limit metadata in the rollout files, the
 * parser goes inside `maybeRecord` and can simply set `used_percent` /
 * `authoritative: true` on the same snapshot shape.
 */

const OFFSET_STATE_KEY = "tokenTracker.claudeCode.offsets.v1";
const POLL_MS = 2000;
const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface OffsetMap {
  [absPath: string]: { size: number; mtimeMs: number };
}

export class ClaudeCodeWatcher implements vscode.Disposable {
  private readonly root = path.join(os.homedir(), ".claude", "projects");
  private offsets: OffsetMap = {};
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
      this.dirWatcher.on("error", () => {/* polling fallback still runs */});
    } catch {
      // some platforms (older Linux) don't support recursive; polling fills the gap.
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
    const backfillCutoff = Date.now() - BACKFILL_WINDOW_MS;

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
        if (startAt >= st.size) {
          this.offsets[file] = { size: st.size, mtimeMs: st.mtimeMs };
          continue;
        }
        await this.ingestTail(file, startAt, st.size);
        this.offsets[file] = { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        // file could have been rotated/deleted between listing and stat; ignore.
      }
    }

    await this.ctx.globalState.update(OFFSET_STATE_KEY, this.offsets);
    this.publishDerivedRateLimits();
  }

  /**
   * Emit a rolling 5h + 7d snapshot derived from already-ingested events.
   * `used_percent` is deliberately null — Claude exposes no authoritative
   * cap locally, so the UI renders these as count pills instead of bars.
   * Safe to call even when no Claude events exist (zero-filled windows).
   */
  private publishDerivedRateLimits(): void {
    const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const w5h = this.store.aggregateSourceWindow("claude-code", FIVE_HOURS_MS, now);
    const w7d = this.store.aggregateSourceWindow("claude-code", SEVEN_DAYS_MS, now);

    this.store.updateRateLimits({
      source: "claude-code",
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

  private async ingestTail(file: string, startAt: number, endAt: number): Promise<void> {
    const length = endAt - startAt;
    if (length <= 0) return;

    const buf = Buffer.alloc(length);
    const fd = await fs.promises.open(file, "r");
    try {
      await fd.read(buf, 0, length, startAt);
    } finally {
      await fd.close();
    }

    const text = buf.toString("utf8");
    const lines = text.split("\n");

    // if we started at a non-line boundary (mid-line), skip the first partial.
    const startIdx = startAt > 0 ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      if (!line) continue;
      try {
        await this.maybeRecord(JSON.parse(line));
      } catch {
        // malformed line — skip.
      }
    }
  }

  private async maybeRecord(row: unknown): Promise<void> {
    if (!row || typeof row !== "object") return;
    const r = row as {
      type?: string;
      uuid?: string;
      timestamp?: string;
      sessionId?: string;
      message?: {
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    };
    if (r.type !== "assistant") return;
    const m = r.message;
    if (!m || !m.model || !m.usage) return;
    const u = m.usage;

    const input_tokens = num(u.input_tokens);
    const output_tokens = num(u.output_tokens);
    const cached_tokens =
      num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);

    if (input_tokens === 0 && output_tokens === 0 && cached_tokens === 0) return;

    await this.store.record({
      provider: "anthropic",
      model: m.model,
      input_tokens,
      output_tokens,
      cached_tokens: cached_tokens > 0 ? cached_tokens : undefined,
      source: "claude-code",
      client_event_id: r.uuid,
      occurred_at: r.timestamp,
    });
  }
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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
