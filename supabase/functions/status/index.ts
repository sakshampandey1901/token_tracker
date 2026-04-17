// Edge Function: POST /functions/v1/status
// Authenticated by the per-user `ingest_token` (same as /ingest).
// Returns the minimum data the status bar / CLI needs:
//   { total_tokens_24h, daily_limit, tier, this_week, last_week }
//
// Read-only, rate-limit friendly, safe to poll every 30s.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  let body: { ingest_token?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body?.ingest_token) return json({ error: "missing_token" }, 400);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, tier, daily_token_limit, monthly_token_limit")
    .eq("ingest_token", body.ingest_token)
    .maybeSingle();
  if (!profile) return json({ error: "unauthorized" }, 401);

  // The views are security_invoker; the admin client bypasses RLS so we filter by id explicitly.
  const [live, weekly] = await Promise.all([
    admin.from("usage_live_24h").select("*").eq("user_id", profile.id).maybeSingle(),
    admin.from("usage_weekly_compare").select("*").eq("user_id", profile.id).maybeSingle(),
  ]);

  return json({
    tier: profile.tier,
    daily_limit:    Number(profile.daily_token_limit),
    monthly_limit:  Number(profile.monthly_token_limit),
    total_tokens_24h: Number(live.data?.total_tokens ?? 0),
    cost_usd_24h:     Number(live.data?.cost_usd ?? 0),
    event_count_24h:  Number(live.data?.event_count ?? 0),
    this_week_tokens: Number(weekly.data?.this_week_tokens ?? 0),
    last_week_tokens: Number(weekly.data?.last_week_tokens ?? 0),
  });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
