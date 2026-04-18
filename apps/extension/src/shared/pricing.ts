import type { LlmProvider } from "./types";

// USD per 1M tokens. Update as providers change prices.
// These numbers are *local estimates* — not authoritative billing.
interface ModelPrice {
  input: number;
  output: number;
  cached?: number;
}

type Catalog = Record<LlmProvider, Record<string, ModelPrice>>;

export const PRICING: Catalog = {
  openai: {
    "gpt-4o":          { input: 2.50,  output: 10.00, cached: 1.25 },
    "gpt-4o-mini":     { input: 0.15,  output: 0.60,  cached: 0.075 },
    "o1":              { input: 15.00, output: 60.00 },
    "o1-mini":         { input: 3.00,  output: 12.00 },
    "o3-mini":         { input: 1.10,  output: 4.40 },
  },
  anthropic: {
    "claude-3-5-sonnet-latest": { input: 3.00,  output: 15.00, cached: 0.30 },
    "claude-3-5-haiku-latest":  { input: 0.80,  output: 4.00,  cached: 0.08 },
    "claude-3-opus-latest":     { input: 15.00, output: 75.00, cached: 1.50 },
  },
  google: {
    "gemini-1.5-pro":   { input: 1.25, output: 5.00 },
    "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  },
  mistral: {
    "mistral-large-latest": { input: 2.00, output: 6.00 },
    "mistral-small-latest": { input: 0.20, output: 0.60 },
  },
  cursor: {
    default: { input: 0, output: 0 },
  },
  custom: {
    default: { input: 0, output: 0 },
  },
};

export function estimateCostUSD(
  provider: LlmProvider,
  model: string,
  input_tokens: number,
  output_tokens: number,
  cached_tokens = 0,
): number {
  const catalog = PRICING[provider] ?? {};
  const entry =
    catalog[model] ??
    catalog[Object.keys(catalog).find((k) => model.startsWith(k)) ?? ""] ??
    catalog.default ??
    { input: 0, output: 0 };
  const c = (entry.cached ?? entry.input) * (cached_tokens / 1_000_000);
  const i = entry.input * (input_tokens / 1_000_000);
  const o = entry.output * (output_tokens / 1_000_000);
  return +(i + o + c).toFixed(6);
}
