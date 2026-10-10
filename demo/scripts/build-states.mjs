// Bundle simulate.ts with the engine source and run it.
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
const out = new URL("../.cache/simulate.mjs", import.meta.url).pathname;
await esbuild.build({
  entryPoints: [new URL("./simulate.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", outfile: out,
  loader: { ".laas": "text" }, external: ["jsdom"], logLevel: "error",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
execFileSync("node", [out], { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
