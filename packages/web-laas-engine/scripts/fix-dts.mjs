// tsc keeps import specifiers as written ("./core/config"), which Node16/NodeNext
// resolution rejects in .d.ts files. Point every relative specifier at the real
// file: "./x" → "./x.js", "./dir" → "./dir/index.js".
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist/types");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith(".d.ts")) yield p;
  }
}

let changed = 0;
for (const file of files(root)) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, pre, spec, post) => {
    if (/\.(m?js|json)$/.test(spec)) return m;
    const base = resolve(dirname(file), spec);
    if (existsSync(`${base}.d.ts`)) return `${pre}${spec}.js${post}`;
    if (existsSync(join(base, "index.d.ts"))) return `${pre}${spec}/index.js${post}`;
    return m;
  });
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`fix-dts: ${changed} declaration files updated`);
