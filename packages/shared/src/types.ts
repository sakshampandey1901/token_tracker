export type LlmProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "cursor"
  | "custom";

export type TierPlan = "free" | "pro" | "team" | "enterprise";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  tier: TierPlan;
  daily_token_limit: number;
  monthly_token_limit: number;
  ingest_token: string;
  created_at: string;
  updated_at: string;
}

export interface UsageEvent {
  id: string;
  user_id: string;
  provider: LlmProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  cost_usd: number;
  source: string;
  occurred_at: string;
  client_event_id: string | null;
  created_at: string;
}

export interface DailyRollup {
  user_id: string;
  day: string; // YYYY-MM-DD
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  updated_at: string;
}

export interface UsageLive24h {
  user_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  event_count: number;
}

export interface WeeklyCompare {
  user_id: string;
  this_week_tokens: number;
  last_week_tokens: number;
  this_week_cost: number;
  last_week_cost: number;
}

export interface IngestEvent {
  provider: LlmProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  cost_usd?: number;
  source?: string;
  client_event_id: string;
  occurred_at?: string;
}

export interface IngestPayload {
  ingest_token: string;
  events: IngestEvent[];
}

export interface IngestResponse {
  accepted: number;
  errors?: Array<{ client_event_id: string; error: string }>;
}

export const TIER_DEFAULTS: Record<
  TierPlan,
  { daily_token_limit: number; monthly_token_limit: number; label: string; color: string }
> = {
  free:       { daily_token_limit:   100_000, monthly_token_limit:   2_000_000, label: "Free",       color: "#6366f1" },
  pro:        { daily_token_limit: 1_000_000, monthly_token_limit:  25_000_000, label: "Pro",        color: "#22c55e" },
  team:       { daily_token_limit: 5_000_000, monthly_token_limit: 150_000_000, label: "Team",       color: "#f59e0b" },
  enterprise: { daily_token_limit: Number.MAX_SAFE_INTEGER, monthly_token_limit: Number.MAX_SAFE_INTEGER, label: "Enterprise", color: "#ef4444" },
};
