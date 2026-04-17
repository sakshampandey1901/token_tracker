import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: watch,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
