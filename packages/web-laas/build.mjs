// Builds the Chrome extension into dist/. The engine comes from the
// web-laas-engine workspace package (its TypeScript source, via the "source" condition).
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const common = {
  bundle: true,
  format: "iife",
  target: "chrome110",
  loader: { ".laas": "text" },
  conditions: ["source"],
  // identifies this build, so a reloaded extension replaces the old main-world script
  define: { __WEB_LAAS_BUILD__: JSON.stringify(Date.now().toString(36)) },
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src/static", "dist", { recursive: true });

const builds = [
  {
    ...common,
    entryPoints: {
      "content-main": "src/content/main.ts",
      "content-isolated": "src/content/isolated.ts",
      cheatsheet: "src/cheatsheet/entry.ts",
      background: "src/background.ts",
      options: "src/options/options.ts",
      popup: "src/popup/popup.ts",
    },
    outdir: "dist",
  },
  {
    // previews of the extension UI outside Chrome (test/preview/*.html)
    ...common,
    entryPoints: { "overlay-preview": "test/preview/src/overlay-preview.ts" },
    outdir: "test/preview/dist",
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  for (const b of builds) await esbuild.build(b);
}
