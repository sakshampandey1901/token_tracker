import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the extension immediately after the vscode:// URI handler fires.
 * Exchanges a one-time pairing code for the user's `ingest_token`.
 *
 * Security:
 *  - The code must exist, be unexpired, and not yet consumed.
 *  - On success it's marked consumed so a replay is impossible.
 *  - No auth header is required — the unguessable code IS the credential
 *    (same model as OAuth device-code flows).
 */
export async function POST(req: NextRequest) {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const code = body?.code?.trim();
  if (!code || code.length < 16) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("pairing_codes")
    .select("user_id, expires_at, consumed_at")
    .eq("code", code)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.consumed_at) {
    return NextResponse.json({ error: "already_used" }, { status: 410 });
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Load the user's ingest_token + the dashboard URL the extension should open.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("ingest_token, email, tier")
    .eq("id", row.user_id)
    .maybeSingle();
  if (profileErr || !profile) {
    return NextResponse.json({ error: "profile_missing" }, { status: 500 });
  }

  // Mark consumed BEFORE returning so a retry after partial response can't double-spend.
  await admin
    .from("pairing_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code);

  return NextResponse.json({
    ingest_token: profile.ingest_token,
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    email: profile.email,
    tier: profile.tier,
  });
}
