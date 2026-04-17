// Compile-time defaults, substituted by esbuild --define.
// See esbuild.config.mjs.
//
// At runtime: an empty string means "not baked in; fall back to user settings".

export const DEFAULTS = {
  dashboardUrl:          process.env.TT_DASHBOARD_URL            ?? "",
  supabaseUrl:           process.env.TT_SUPABASE_URL             ?? "",
  supabasePublishableKey:process.env.TT_SUPABASE_PUBLISHABLE_KEY ?? "",
} as const;

export function hasBakedInDefaults(): boolean {
  return Boolean(DEFAULTS.dashboardUrl && DEFAULTS.supabaseUrl);
}
