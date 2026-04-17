// Extension bundler with compile-time defaults.
//
// These env vars are inlined at build time via esbuild --define and become
// the extension's fallback when the user hasn't configured settings yourself.
// When you publish your own instance, set them before running `pnpm build`:
//
//   TT_DASHBOARD_URL=https://tokentracker.example.com
//   TT_SUPABASE_URL=https://xxxx.supabase.co
//   TT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
//
// Users who install the resulting VSIX never have to type any URL.

import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const define = {
  "process.env.TT_DASHBOARD_URL":           JSON.stringify(process.env.TT_DASHBOARD_URL ?? ""),
  "process.env.TT_SUPABASE_URL":            JSON.stringify(process.env.TT_SUPABASE_URL ?? ""),
  "process.env.TT_SUPABASE_PUBLISHABLE_KEY":JSON.stringify(process.env.TT_SUPABASE_PUBLISHABLE_KEY ?? ""),
};

const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: watch,
  minify: !watch,
  define,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
