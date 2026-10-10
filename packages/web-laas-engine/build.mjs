// Builds the library (ESM + .d.ts + drop-in IIFE) and the editor test pages.
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";

const common = { bundle: true, target: "es2022", loader: { ".laas": "text" }, logLevel: "info" };

await rm("dist", { recursive: true, force: true });

// Library: ESM, one file per entry.
await esbuild.build({
  ...common,
  entryPoints: { index: "src/index.ts", dom: "src/dom.ts" },
  format: "esm",
  splitting: true,
  outdir: "dist",
});
// Drop-in script for any page.
await esbuild.build({
  ...common,
  entryPoints: { "web-laas-engine.auto": "src/auto.ts" },
  format: "iife",
  outdir: "dist",
});
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });

// Editor test pages (test/editor/*.html).
await esbuild.build({
  ...common,
  entryPoints: {
    cm6: "test/editor/src/cm6.ts",
    cm5: "test/editor/src/cm5.ts",
    prosemirror: "test/editor/src/prosemirror.ts",
  },
  format: "iife",
  outdir: "test/editor/dist",
});
await cp("dist/web-laas-engine.auto.js", "test/editor/dist/web-laas-engine.auto.js");
await cp("../../node_modules/codemirror5/lib/codemirror.css", "test/editor/dist/codemirror5.css");
await cp("../../node_modules/prosemirror-view/style/prosemirror.css", "test/editor/dist/prosemirror.css");
