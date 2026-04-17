import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin (service-role) Supabase client.
 * SERVER-ONLY. Never import this from a file that can be sent to the browser.
 * Used exclusively by API route handlers that need to bypass RLS —
 * currently only the pairing-code exchange.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srk) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL. " +
        "Set them in apps/web/.env.local — never prefix the service role with NEXT_PUBLIC_.",
    );
  }
  return createSupabaseClient(url, srk, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
