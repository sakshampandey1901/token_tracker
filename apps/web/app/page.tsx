import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
import { Landing } from "@/components/landing";
import type { Profile, DailyRollup } from "@token-tracker/shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  // If env isn't configured yet (fresh clone), render a quick setup notice.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <Landing mode="setup" />;
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <Landing mode="login" />;

  // Seed the client-side dashboard with server data so the first paint has no spinner.
  const [{ data: profile }, { data: rollups }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("daily_rollups")
      .select("*")
      .gte("day", isoDay(daysAgo(14)))
      .order("day", { ascending: true }),
  ]);

  if (!profile) {
    // Extremely rare: trigger didn't fire. Redirect to login to retry.
    redirect("/login");
  }

  return (
    <Dashboard
      initialProfile={profile as Profile}
      initialRollups={(rollups ?? []) as DailyRollup[]}
    />
  );
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
