const required = (k: string, v: string | undefined): string => {
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${k}. See .env.example.`);
  }
  return v;
};

export const PUBLIC_ENV = {
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} as const;

export function readPublicEnv() {
  return {
    SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL", PUBLIC_ENV.SUPABASE_URL),
    SUPABASE_PUBLISHABLE_KEY: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      PUBLIC_ENV.SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}
