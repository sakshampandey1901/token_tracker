"use client";

import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "../env";

export function createClient() {
  const env = readPublicEnv();
  return createBrowserClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
}
