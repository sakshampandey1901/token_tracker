"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRollup } from "@token-tracker/shared";
import { formatTokens } from "@/lib/utils";

interface Props {
  rollups: DailyRollup[];
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeeklyCompare({ rollups }: Props) {
  const byDay = new Map(rollups.map((r) => [r.day, Number(r.total_tokens)]));

  const now = new Date();
  const mondayThis = startOfISOWeek(now);
  const mondayLast = addDays(mondayThis, -7);

  const data = Array.from({ length: 7 }, (_, i) => {
    const t = addDays(mondayThis, i);
    const l = addDays(mondayLast, i);
    return {
      dow: DOW[i],
      this_week: byDay.get(iso(t)) ?? 0,
      last_week: byDay.get(iso(l)) ?? 0,
    };
  });

  const totalThis = data.reduce((a, d) => a + d.this_week, 0);
  const totalLast = data.reduce((a, d) => a + d.last_week, 0);
  const deltaPct  = totalLast === 0 ? null : ((totalThis - totalLast) / totalLast) * 100;

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">Weekly comparison</div>
          <div className="mt-1 text-xl font-semibold">
            This week vs. last week
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted">This week</div>
          <div className="text-lg font-semibold tabular-nums">{formatTokens(totalThis)}</div>
          {deltaPct !== null && (
            <div className={`text-xs ${deltaPct >= 0 ? "text-warn" : "text-ok"}`}>
              {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}% vs last week
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2430" />
            <XAxis dataKey="dow" stroke="#8b93a7" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#8b93a7"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatTokens(Number(v))}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "#12151d",
                border: "1px solid #1f2430",
                borderRadius: 8,
                color: "#e6e8ef",
              }}
              formatter={(v: number) => formatTokens(Number(v))}
              labelStyle={{ color: "#8b93a7" }}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ paddingTop: 8, color: "#8b93a7", fontSize: 12 }}
            />
            <Bar dataKey="last_week" name="Last week" fill="#8b93a7" radius={[4, 4, 0, 0]} />
            <Bar dataKey="this_week" name="This week" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function startOfISOWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
