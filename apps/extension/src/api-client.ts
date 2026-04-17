import type {
  IngestEvent,
  IngestResponse,
  LlmProvider,
} from "@token-tracker/shared";
import { estimateCostUSD } from "@token-tracker/shared";
import { randomUUID } from "crypto";

interface StatusResponse {
  tier: string;
  daily_limit: number;
  monthly_limit: number;
  total_tokens_24h: number;
  cost_usd_24h: number;
  event_count_24h: number;
  this_week_tokens: number;
  last_week_tokens: number;
}

export interface ApiClientOpts {
  getSupabaseUrl: () => string;
  getIngestToken: () => Promise<string>;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOpts) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(this.opts.getSupabaseUrl()) && Boolean(await this.opts.getIngestToken());
  }

  async getStatus(): Promise<StatusResponse | null> {
    const url = this.opts.getSupabaseUrl();
    const token = await this.opts.getIngestToken();
    if (!url || !token) return null;
    try {
      const res = await fetch(`${url}/functions/v1/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ingest_token: token }),
      });
      if (!res.ok) return null;
      return (await res.json()) as StatusResponse;
    } catch {
      return null;
    }
  }

  /**
   * Accepts a loose event (partial fields) and normalizes it into the ingest shape.
   * Cost is estimated locally if the caller didn't provide it.
   */
  async report(raw: {
    provider: LlmProvider;
    model: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cost_usd?: number;
    source?: string;
    client_event_id?: string;
    occurred_at?: string;
  }): Promise<IngestResponse | null> {
    const url = this.opts.getSupabaseUrl();
    const token = await this.opts.getIngestToken();
    if (!url || !token) return null;

    const input_tokens  = Math.max(0, Math.floor(raw.input_tokens  ?? 0));
    const output_tokens = Math.max(0, Math.floor(raw.output_tokens ?? 0));
    const cached_tokens = Math.max(0, Math.floor(raw.cached_tokens ?? 0));
    const cost_usd =
      raw.cost_usd != null
        ? Math.max(0, raw.cost_usd)
        : estimateCostUSD(raw.provider, raw.model, input_tokens, output_tokens, cached_tokens);

    const ev: IngestEvent = {
      provider: raw.provider,
      model: raw.model,
      input_tokens,
      output_tokens,
      cached_tokens,
      cost_usd,
      source: raw.source ?? "extension",
      client_event_id: raw.client_event_id ?? randomUUID(),
      occurred_at: raw.occurred_at ?? new Date().toISOString(),
    };

    const res = await fetch(`${url}/functions/v1/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ingest_token: token, events: [ev] }),
    });
    if (!res.ok && res.status !== 207) return null;
    return (await res.json()) as IngestResponse;
  }
}
