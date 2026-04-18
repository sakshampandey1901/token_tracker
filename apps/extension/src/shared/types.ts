export type LlmProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "cursor"
  | "custom";

/**
 * A single usage event, as persisted in the local store.
 * No `user_id` — this tracker is local-only.
 */
export interface UsageEvent {
  /** ULID-ish unique id generated locally. */
  id: string;
  provider: LlmProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  cost_usd: number;
  /** Free-form tag: "extension", "local-ingest", "programmatic", … */
  source: string;
  /** ISO timestamp of when the call happened. */
  occurred_at: string;
  /** ISO timestamp of when we recorded it. */
  recorded_at: string;
  /** Caller-supplied id used for local de-duplication. */
  client_event_id: string | null;
}

/**
 * Inbound event shape accepted by the extension (programmatic + HTTP).
 * Missing fields are filled in with defaults.
 */
export interface IngestEvent {
  provider: LlmProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  cost_usd?: number;
  source?: string;
  client_event_id?: string;
  occurred_at?: string;
}

export interface AggregateWindow {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  event_count: number;
}

export interface DailyBucket extends AggregateWindow {
  /** YYYY-MM-DD, local timezone. */
  day: string;
}

export interface ProviderBreakdown extends AggregateWindow {
  provider: LlmProvider;
}

export interface SourceBreakdown extends AggregateWindow {
  source: string;
}

/**
 * A rate-limit window reported by (or derived for) a provider.
 *
 * `used_percent` is only populated when an authoritative cap is known
 * (e.g. Codex CLI writes `used_percent` into rollouts). When a watcher has
 * only observed counts — no real cap — it leaves `used_percent: null` and
 * fills `used_tokens` / `used_messages` instead, so the UI can render a
 * count pill rather than inventing a denominator.
 *
 * `resets_at` is a unix-seconds timestamp, or 0 for purely rolling windows
 * (e.g. "trailing 5 hours" has no hard reset boundary).
 */
export interface RateLimitWindow {
  label: string;                 // "Session" | "Weekly" | "5h" | "7d" | free-form
  used_percent: number | null;   // 0..100 when a real cap is known, else null
  used_tokens?: number;          // observed token count in the window
  used_messages?: number;        // observed assistant-message count in the window
  window_minutes: number;        // how long the bucket covers (e.g. 300, 10080)
  resets_at: number;             // unix seconds, or 0 for rolling windows
}

/**
 * Rate-limit info from one provider's watcher. The store holds one of these
 * per `source`, so Codex and Claude don't overwrite each other.
 */
export interface RateLimitsSnapshot {
  source: string;                // "codex" | "claude-code" | …
  plan: string | null;           // "free" | "plus" | "pro" | …
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  updated_at: string;            // ISO timestamp of the observation
  /**
   * True when `used_percent` values come from an upstream authoritative
   * source (Codex CLI today). False / absent when they're derived locally
   * from observed counts.
   */
  authoritative?: boolean;
}

/**
 * Snapshot the status bar and dashboard read from.
 * Everything here is derived from the local event store.
 */
export interface UsageSnapshot {
  daily_limit: number;
  window_24h: AggregateWindow;
  this_week: AggregateWindow;
  last_week: AggregateWindow;
  last_7_days: DailyBucket[];
  by_provider_24h: ProviderBreakdown[];
  by_source_24h: SourceBreakdown[];
  by_source_5h: SourceBreakdown[];
  recent: UsageEvent[];
  /**
   * Pick of the most "important" snapshot across all sources, chosen by:
   *   1. the one with the highest known `used_percent`, else
   *   2. the most recently updated.
   * Kept for the single-slot status-bar consumer; the dashboard should
   * iterate `rate_limits_by_source` for the full picture.
   */
  rate_limits: RateLimitsSnapshot | null;
  /** Per-provider snapshots, keyed by `source`. */
  rate_limits_by_source: Record<string, RateLimitsSnapshot>;
}

/**
 * Default daily token limit for a new install.
 * Overridable via the `tokenTracker.dailyTokenLimit` setting.
 */
export const DEFAULT_DAILY_TOKEN_LIMIT = 1_000_000;
export const DEFAULT_DAILY_TOKEN_LIMIT_CLAUDE = 1_000_000;
export const DEFAULT_DAILY_TOKEN_LIMIT_CODEX = 1_000_000;
