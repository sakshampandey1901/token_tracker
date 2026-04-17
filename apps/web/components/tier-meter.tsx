"use client";

import { formatTokens, percent } from "@/lib/utils";

interface Props {
  tokensUsed: number;
  dailyLimit: number;
  tierLabel: string;
  tierColor: string;
}

export function TierMeter({ tokensUsed, dailyLimit, tierLabel, tierColor }: Props) {
  const pct = percent(tokensUsed, dailyLimit);
  const state =
    pct >= 95 ? { tone: "text-danger", ring: "ring-danger/40", msg: "Throttle imminent" }
    : pct >= 80 ? { tone: "text-warn",   ring: "ring-warn/40",   msg: "Heads up" }
    : { tone: "text-ok", ring: "ring-ok/30", msg: "Healthy" };

  return (
    <div className={`rounded-2xl border border-border bg-surface p-6 shadow-card ring-1 ${state.ring}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">24-hour rolling</div>
          <div className="mt-1 text-4xl md:text-5xl font-semibold tabular-nums">
            {formatTokens(tokensUsed)}
            <span className="text-muted text-base font-normal ml-2">
              / {formatTokens(dailyLimit)}
            </span>
          </div>
          <div className={`mt-2 text-sm ${state.tone}`}>{state.msg} · {pct.toFixed(1)}%</div>
        </div>
        <div className="text-right">
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: `${tierColor}20`, color: tierColor }}
          >
            {tierLabel} plan
          </span>
        </div>
      </div>

      <div className="mt-6 h-3 w-full overflow-hidden rounded-full bg-bg border border-border">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: tierColor }}
        />
      </div>

      <div className="mt-4 flex justify-between text-xs text-muted">
        <span>0</span>
        <span>50%</span>
        <span>{formatTokens(dailyLimit)}</span>
      </div>
    </div>
  );
}
