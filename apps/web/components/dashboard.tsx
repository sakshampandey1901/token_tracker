"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type { Profile, DailyRollup, UsageEvent } from "@token-tracker/shared";
import { TIER_DEFAULTS } from "@token-tracker/shared";
import { createClient } from "@/lib/supabase/client";
import { TierMeter } from "./tier-meter";
import { WeeklyCompare } from "./weekly-compare";
import { LiveFeed } from "./live-feed";
import { Header } from "./header";
import { IngestTokenCard } from "./ingest-token-card";

interface Props {
  initialProfile: Profile;
  initialRollups: DailyRollup[];
}

export function Dashboard({ initialProfile, initialRollups }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [rollups, setRollups] = useState<DailyRollup[]>(initialRollups);
  const [recent, setRecent] = useState<UsageEvent[]>([]);
  const [live24h, setLive24h] = useState<number>(sumLast24h(initialRollups));
  const [connected, setConnected] = useState<boolean>(false);

  // Load last ~50 events and the materialized 24h view for an accurate first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: events }, { data: live }] = await Promise.all([
        supabase
          .from("usage_events")
          .select("*")
          .order("occurred_at", { ascending: false })
          .limit(50),
        supabase.from("usage_live_24h").select("total_tokens").maybeSingle(),
      ]);
      if (cancelled) return;
      if (events) setRecent(events as UsageEvent[]);
      if (live?.total_tokens != null) setLive24h(Number(live.total_tokens));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Realtime: insert events → prepend to feed + bump 24h counter if within window.
  useEffect(() => {
    const channel = supabase
      .channel(`usage:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "usage_events", filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const ev = payload.new as UsageEvent;
          setRecent((prev) => [ev, ...prev].slice(0, 100));
          if (withinLast24h(ev.occurred_at)) {
            setLive24h((n) => n + Number(ev.total_tokens ?? 0));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_rollups", filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const row = payload.new as DailyRollup;
          setRollups((prev) => {
            const i = prev.findIndex((r) => r.day === row.day);
            if (i === -1) return [...prev, row].sort((a, b) => a.day.localeCompare(b.day));
            const next = prev.slice();
            next[i] = row;
            return next;
          });
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, profile.id]);

  // Sanity: every 60s re-sync 24h total (in case a tab missed a realtime event).
  useEffect(() => {
    const t = setInterval(async () => {
      const { data } = await supabase.from("usage_live_24h").select("total_tokens").maybeSingle();
      if (data?.total_tokens != null) setLive24h(Number(data.total_tokens));
    }, 60_000);
    return () => clearInterval(t);
  }, [supabase]);

  const tier = TIER_DEFAULTS[profile.tier];
  const rotateIngestToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/rotate-token`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}` },
      },
    );
    if (!res.ok) return;
    const { ingest_token } = (await res.json()) as { ingest_token: string };
    setProfile((p) => ({ ...p, ingest_token }));
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, [supabase]);

  return (
    <main className="mx-auto max-w-7xl px-4 md:px-6 py-6">
      <Header
        email={profile.email}
        displayName={profile.display_name ?? profile.email}
        connected={connected}
        onSignOut={signOut}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TierMeter
            tokensUsed={live24h}
            dailyLimit={profile.daily_token_limit}
            tierLabel={tier.label}
            tierColor={tier.color}
          />
        </div>
        <div>
          <IngestTokenCard
            token={profile.ingest_token}
            supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
            onRotate={rotateIngestToken}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WeeklyCompare rollups={rollups} />
        </div>
        <div>
          <LiveFeed events={recent} />
        </div>
      </div>
    </main>
  );
}

function sumLast24h(rollups: DailyRollup[]): number {
  const today  = new Date().toISOString().slice(0, 10);
  const yester = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return rollups
    .filter((r) => r.day === today || r.day === yester)
    .reduce((a, r) => a + Number(r.total_tokens), 0);
}

function withinLast24h(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < 24 * 3600_000;
}
