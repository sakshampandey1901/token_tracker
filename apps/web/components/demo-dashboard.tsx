"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyRollup, UsageEvent, LlmProvider } from "@token-tracker/shared";
import { TIER_DEFAULTS, estimateCostUSD } from "@token-tracker/shared";
import { TierMeter } from "./tier-meter";
import { WeeklyCompare } from "./weekly-compare";
import { LiveFeed } from "./live-feed";
import { Header } from "./header";
import { IngestTokenCard } from "./ingest-token-card";

// Seed ~14 days of synthetic usage so the weekly-compare chart has both weeks populated.
function seedRollups(): DailyRollup[] {
  const out: DailyRollup[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const base = 40_000 + Math.floor(Math.random() * 80_000);
    const bump = i < 7 ? Math.floor(Math.random() * 40_000) : 0;
    const total = base + bump;
    const input = Math.floor(total * 0.7);
    const output = total - input;
    out.push({
      user_id: "demo",
      day,
      total_tokens: total,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: 0,
      cost_usd: estimateCostUSD("openai", "gpt-4o", input, output),
      updated_at: new Date().toISOString(),
    });
  }
  return out;
}

function seedEvents(n: number): UsageEvent[] {
  const providers: LlmProvider[] = ["openai", "anthropic", "google", "cursor"];
  const models: Record<LlmProvider, string[]> = {
    openai:    ["gpt-4o", "gpt-4o-mini", "o1-mini"],
    anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    google:    ["gemini-1.5-pro", "gemini-1.5-flash"],
    cursor:    ["default"],
    mistral:   ["mistral-large-latest"],
    custom:    ["default"],
  };
  const out: UsageEvent[] = [];
  for (let i = 0; i < n; i++) {
    const p = providers[i % providers.length]!;
    const m = models[p][i % models[p].length]!;
    const input = 200 + Math.floor(Math.random() * 3000);
    const output = 100 + Math.floor(Math.random() * 1500);
    out.push({
      id: `demo-${i}`,
      user_id: "demo",
      provider: p,
      model: m,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: 0,
      total_tokens: input + output,
      cost_usd: estimateCostUSD(p, m, input, output),
      source: "demo",
      occurred_at: new Date(Date.now() - i * 37_000).toISOString(),
      client_event_id: `demo-${i}`,
      created_at: new Date().toISOString(),
    });
  }
  return out;
}

export function DemoDashboard() {
  const tier = TIER_DEFAULTS.free;
  const initialRollups = useMemo(seedRollups, []);
  const initialEvents  = useMemo(() => seedEvents(30), []);
  const [rollups, setRollups] = useState<DailyRollup[]>(initialRollups);
  const [events, setEvents]   = useState<UsageEvent[]>(initialEvents);

  const live24h = events
    .filter((e) => Date.now() - Date.parse(e.occurred_at) < 24 * 3600_000)
    .reduce((a, e) => a + e.total_tokens, 0);

  // Simulate realtime: push a new event every 4s so the dashboard visibly "lives".
  useEffect(() => {
    const id = setInterval(() => {
      const [fresh] = seedEvents(1);
      const ev: UsageEvent = { ...fresh!, id: `demo-${Date.now()}`, occurred_at: new Date().toISOString() };
      setEvents((prev) => [ev, ...prev].slice(0, 100));
      const today = new Date().toISOString().slice(0, 10);
      setRollups((prev) => {
        const i = prev.findIndex((r) => r.day === today);
        if (i === -1) return prev;
        const next = prev.slice();
        next[i] = {
          ...next[i]!,
          total_tokens: next[i]!.total_tokens + ev.total_tokens,
          input_tokens: next[i]!.input_tokens + ev.input_tokens,
          output_tokens: next[i]!.output_tokens + ev.output_tokens,
          cost_usd: next[i]!.cost_usd + ev.cost_usd,
        };
        return next;
      });
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-4 md:px-6 py-6">
      <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 text-accent text-xs px-3 py-2">
        Demo mode — synthetic data, no account, updates every 4s.
        Point the extension at a real Supabase project to see your own numbers.
      </div>
      <Header
        email="demo@token-tracker.local"
        displayName="Demo"
        connected={true}
        onSignOut={() => (window.location.href = "/")}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TierMeter
            tokensUsed={live24h}
            dailyLimit={tier.daily_token_limit}
            tierLabel={tier.label}
            tierColor={tier.color}
          />
        </div>
        <div>
          <IngestTokenCard
            token="demodemo-demodemo-demodemo-demodemo-demodemo-demodemo-demodemo"
            supabaseUrl="https://demo.supabase.co"
            onRotate={async () => {}}
          />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WeeklyCompare rollups={rollups} />
        </div>
        <div>
          <LiveFeed events={events} />
        </div>
      </div>
    </main>
  );
}
