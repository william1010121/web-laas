// Builds the showcase site into site/dist:
//   1. records every scene with the real engine (tools/simulate.ts → scenes.json)
//   2. bundles src/site.ts (engine, live preview, in-place rendering, cheat sheet)
//   3. copies index.html, site.css and images
// node site/tools/build.mjs [--watch]
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dist = `${root}dist`;
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(`${dist}/assets`, { recursive: true });

const sim = `${root}.cache/simulate.mjs`;
await esbuild.build({
  entryPoints: [`${root}tools/simulate.ts`],
  bundle: true, platform: "node", format: "esm", outfile: sim,
  loader: { ".laas": "text" }, external: ["jsdom"], logLevel: "error",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
execFileSync("node", [sim, `${dist}/assets/scenes.json`], { stdio: "inherit" });

const opts = {
  entryPoints: { "assets/site": `${root}src/site.ts` },
  bundle: true, format: "esm", target: "es2022", outdir: dist,
  loader: { ".laas": "text" }, minify: !watch, logLevel: "info", conditions: ["source"],
  define: { __WEB_LAAS_BUILD__: JSON.stringify("site") },
};
cpSync(`${root}index.html`, `${dist}/index.html`);
cpSync(`${root}site.css`, `${dist}/assets/site.css`);
cpSync(`${root}../packages/web-laas/src/static/icons/on-128.png`, `${dist}/assets/icon.png`);
cpSync(`${root}img`, `${dist}/assets/img`, { recursive: true });
if (watch) await (await esbuild.context(opts)).watch();
else await esbuild.build(opts);
