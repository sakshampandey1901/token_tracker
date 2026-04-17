import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called from /pair when an authenticated user clicks "Connect to editor".
 * Mints a short-lived, one-time code that the extension will exchange
 * for the user's ingest_token via /api/pair/exchange.
 *
 * Why a one-time code instead of putting the ingest_token in the URL directly:
 *  - URLs leak into browser history, OS logs, and `vscode://` handler logs
 *  - A code that self-destructs after one exchange limits the blast radius
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let editor: "vscode" | "cursor" = "vscode";
  try {
    const body = (await req.json()) as { editor?: string };
    if (body.editor === "cursor") editor = "cursor";
  } catch {
    /* body is optional */
  }

  const code = randomBytes(24).toString("base64url"); // 32-char URL-safe
  const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

  const admin = createAdminClient();
  const { error: insertErr } = await admin.from("pairing_codes").insert({
    code,
    user_id: user.id,
    editor_scheme: editor,
    expires_at,
  });

  if (insertErr) {
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  return NextResponse.json({ code, expires_at, editor });
}
