// Edge Function: POST /functions/v1/rotate-token
// Lets an authenticated user rotate their `ingest_token` (e.g. after losing a machine).
// Requires a valid Supabase auth JWT; uses service role only to write the new token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  // Identify the caller via their user JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const newToken = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(newToken).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { error } = await admin
    .from("profiles")
    .update({ ingest_token: hex, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return new Response(JSON.stringify({ error: "rotate_failed" }), { status: 500 });
  }
  return new Response(JSON.stringify({ ingest_token: hex }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
