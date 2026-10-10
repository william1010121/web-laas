// npm run test:types — the declarations must work for Node ESM (nodenext) and bundlers.
import { execFileSync } from "node:child_process";
const file = new URL("./consumer.ts", import.meta.url).pathname;
for (const [module, resolution] of [["nodenext", "nodenext"], ["esnext", "bundler"]]) {
  execFileSync("npx", ["tsc", "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "false", "--types", "",
    "--lib", "es2022,dom", "--module", module, "--moduleResolution", resolution, file], { stdio: "inherit" });
  console.log(`types ok: moduleResolution ${resolution}`);
}
