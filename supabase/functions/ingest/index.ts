// Edge Function: POST /functions/v1/ingest
// Authenticates the VS Code / Cursor extension via a per-user `ingest_token`
// (rotatable, stored in profiles, NEVER exposed to the browser).
// Forwards events to the service-role `ingest_usage` RPC.
//
// Why this design:
//  - The extension lives on the user's machine and can't safely hold an OAuth
//    refresh token long term, but we still need to attribute events to a user.
//  - A short-lived supabase JWT would force a browser re-login periodically.
//  - A rotatable, server-side secret is simpler and equally secure for append-only ingest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type IncomingEvent = {
  provider: "openai" | "anthropic" | "google" | "mistral" | "cursor" | "custom";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  cost_usd?: number;
  source?: string;
  client_event_id: string;     // required for idempotency
  occurred_at?: string;        // ISO-8601
};

type IngestPayload = {
  ingest_token: string;
  events: IncomingEvent[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_EVENTS_PER_REQUEST = 500;

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "content-type": "application/json",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  let payload: IngestPayload;
  try {
    payload = (await req.json()) as IngestPayload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  if (!payload?.ingest_token || !Array.isArray(payload.events)) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }
  if (payload.events.length === 0) {
    return new Response(JSON.stringify({ accepted: 0 }), { status: 200, headers: corsHeaders(origin) });
  }
  if (payload.events.length > MAX_EVENTS_PER_REQUEST) {
    return new Response(JSON.stringify({ error: "too_many_events", max: MAX_EVENTS_PER_REQUEST }), {
      status: 413,
      headers: corsHeaders(origin),
    });
  }

  // Resolve the user by ingest_token (constant-time-ish via unique index).
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id")
    .eq("ingest_token", payload.ingest_token)
    .maybeSingle();

  if (profileErr || !profile) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: corsHeaders(origin),
    });
  }

  let accepted = 0;
  const errors: Array<{ client_event_id: string; error: string }> = [];

  for (const ev of payload.events) {
    if (!ev.client_event_id || typeof ev.client_event_id !== "string") {
      errors.push({ client_event_id: String(ev.client_event_id ?? ""), error: "missing_client_event_id" });
      continue;
    }
    const { error } = await admin.rpc("ingest_usage", {
      p_user_id: profile.id,
      p_provider: ev.provider,
      p_model: ev.model,
      p_input_tokens: ev.input_tokens | 0,
      p_output_tokens: ev.output_tokens | 0,
      p_cached_tokens: (ev.cached_tokens ?? 0) | 0,
      p_cost_usd: ev.cost_usd ?? 0,
      p_source: ev.source ?? "extension",
      p_client_event_id: ev.client_event_id,
      p_occurred_at: ev.occurred_at ?? new Date().toISOString(),
    });
    if (error) errors.push({ client_event_id: ev.client_event_id, error: error.message });
    else accepted += 1;
  }

  return new Response(JSON.stringify({ accepted, errors }), {
    status: errors.length === 0 ? 200 : 207,
    headers: corsHeaders(origin),
  });
});
