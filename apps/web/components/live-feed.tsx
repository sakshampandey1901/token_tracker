"use client";

import type { UsageEvent } from "@token-tracker/shared";
import { formatTokens, formatUSD } from "@/lib/utils";

export function LiveFeed({ events }: { events: UsageEvent[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card h-full flex flex-col">
      <div className="px-5 pt-5 pb-2">
        <div className="text-xs uppercase tracking-wider text-muted">Recent events</div>
        <div className="text-sm text-muted">Last 50 — streamed in realtime</div>
      </div>
      <div className="flex-1 overflow-auto scroll-slim px-2 pb-2">
        {events.length === 0 ? (
          <div className="text-center text-sm text-muted py-10">
            No events yet. Install the extension and make an LLM call.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{e.model}</div>
                  <div className="text-xs text-muted truncate">
                    {e.provider} · {new Date(e.occurred_at).toLocaleTimeString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm tabular-nums">{formatTokens(e.total_tokens)}</div>
                  <div className="text-xs text-muted tabular-nums">{formatUSD(Number(e.cost_usd))}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
