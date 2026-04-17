import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readPublicEnv } from "../env";

export function createClient() {
  const env = readPublicEnv();
  const cookieStore = cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components can't set cookies; middleware covers that path.
        }
      },
    },
  });
}
