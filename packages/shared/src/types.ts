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
  recent: UsageEvent[];
}

/**
 * Default daily token limit for a new install.
 * Overridable via the `tokenTracker.dailyTokenLimit` setting.
 */
export const DEFAULT_DAILY_TOKEN_LIMIT = 1_000_000;
