// Generate src/core/cdlatex.laas from cdlatex.el's default tables.
//   emacs --batch -l scripts/dump-cdlatex.el > scripts/cdlatex-defaults.json
//   node scripts/gen-cdlatex.mjs
import { readFile, writeFile } from "node:fs/promises";

const here = new URL(".", import.meta.url);
const d = JSON.parse(await readFile(new URL("cdlatex-defaults.json", here), "utf8"));
const nil = (v) => (v === "json-null" || v === null || v === "" ? null : v);
const q = (s) => JSON.stringify(s);
// cdlatex marks the cursor with "?"; our templates use $0. Escape nothing else:
// cdlatex templates contain no "$" or "[[".
const cursor = (s) => (s.includes("?") ? s.replace("?", "$0") : s + "$0");
const OVERLEAF = '["overleaf.com"]';

const out = [];
const group = (name, options, items, extra = "") =>
  out.push(`    {\n      group: ${q(name)},\n      options: ${q(options)},${extra}\n      snippets: [\n${items.map((i) => `        ${i},`).join("\n")}\n      ],\n    },`);

// ── ` math symbols (cdlatex-math-symbol-alist): ` = level 1, `` = level 2, … ──
const symbols = [];
const symbolsText = [];
for (const [ch, levels] of d.symbol) {
  levels.forEach((sym, i) => {
    sym = nil(sym);
    if (!sym) return;
    const trigger = "`".repeat(i + 1) + ch;
    const desc = i ? `, description: ${q(`level ${i + 1}`)}` : "";
    symbols.push(`{ trigger: ${q(trigger)}, replacement: ${q(cursor(sym).replace(/\$0$/, ""))}${desc} }`);
    // outside math cdlatex adds the dollars (cdlatex-ensure-math)
    symbolsText.push(`{ trigger: ${q(trigger)}, replacement: ${q("$" + cursor(sym) + "$")} }`);
  });
}
group("cdlatex · ` Math symbols", "mA", symbols);

// ── ' math modify (cdlatex-math-modify-alist) ──
const modify = [];
const modifyText = [];
for (const [ch, math, text, acc, rmdot] of d.modify) {
  const spec = (cmd) =>
    `{ trigger: ${q("'" + ch)}, action: "cdlatex-modify", command: ${q(nil(cmd))}, accent: ${!!nil(acc)}, rmdot: ${!!nil(rmdot)} }`;
  if (nil(math)) modify.push(spec(math));
  if (nil(text)) modifyText.push(spec(text));
}
group("cdlatex · ' Modifiers (accents, fonts)", "mA", modify);

// ── _ ^ (cdlatex-sub-superscript), twice → \mathrm ──
group("cdlatex · _ ^ Subscripts and superscripts", "mA", [
  `{ trigger: "_", replacement: "_{$0}", preview: "x_{\\\\square}" }`,
  `{ trigger: "^", replacement: "^{$0}", preview: "x^{\\\\square}" }`,
  `{ trigger: "_{_", replacement: "_{\\\\mathrm{$0}", preview: "x_{\\\\mathrm{a}}", description: "_ twice → upright subscript" }`,
  `{ trigger: "^{^", replacement: "^{\\\\mathrm{$0}", preview: "x^{\\\\mathrm{a}}", description: "^ twice → upright superscript" }`,
]);

// ── Tab commands (cdlatex-command-alist) ──
const env = new Map(d.env.map(([name, tpl]) => [name, nil(tpl)]));
const envTemplate = (name) => {
  let t = env.get(name) ?? `\\begin{${name}}\n?\n\\end{${name}}`;
  t = t.replace(/AUTOFILE/g, "");
  // no reftex: drop AUTOLABEL, and the line if that leaves it empty
  t = t
    .split("\n")
    .filter((line) => !/^\s*AUTOLABEL\s*$/.test(line))
    .join("\n")
    .replace(/AUTOLABEL ?/g, "");
  return cursor(t);
};
const LR = { "(": ["(", ")"], "[": ["[", "]"], "{": ["\\{", "\\}"], "<": ["\\langle", "\\rangle"], "|": ["|", "|"] };
const mathCmds = [];
const textCmds = [];
const skipped = [];
for (const [key, doc, repl, hook, args, textOk, mathOk] of d.command) {
  let tpl = null;
  if (hook === "#cdlatex-environment" && Array.isArray(nil(args))) tpl = envTemplate(args[0]);
  else if (hook === "#cdlatex-lr-pair") {
    const [o, c] = LR[repl];
    tpl = `\\left${o} $0 \\right${c}`;
  } else if (key === "it") tpl = "\\item $0";
  else if (key === "inc") tpl = "\\includegraphics[]{$0}";
  else if (hook === "#cdlatex-position-cursor" || hook === "json-null") tpl = nil(repl) ? cursor(repl) : null;
  if (!tpl) {
    skipped.push(key);
    continue;
  }
  const item = `{ trigger: ${q(key)}, replacement: ${q(tpl)}, description: ${q(doc)} }`;
  // \item is meaningless in math, and "it" is a common index (x_{it}⇥)
  if (nil(mathOk) && key !== "it") mathCmds.push(item);
  if (nil(textOk)) textCmds.push(item);
}
group("cdlatex · Tab commands (math)", "mw", mathCmds);
group("cdlatex · Tab commands (document)", "tw", textCmds, `\n      sites: ${OVERLEAF},`);
group("cdlatex · ' Modifiers (text mode)", "tA", modifyText, `\n      sites: ${OVERLEAF},`);
group("cdlatex · ` Symbols (text mode, adds $)", "tA", symbolsText, `\n      sites: ${OVERLEAF},`);

const header = `// cdlatex's (Carsten Dominik) default tables, generated from cdlatex.el by scripts/gen-cdlatex.mjs. Don't edit by hand.
// Document commands and text-mode ' \` are on in Overleaf only (they'd trigger in ordinary text elsewhere).
// Not ported (they need reftex or interactive input): ${skipped.join(", ")}
`;
await writeFile(new URL("../src/core/cdlatex.laas", here), `${header}{\n  snippets: [\n${out.join("\n")}\n  ],\n}\n`);
console.log(`symbols ${symbols.length}, modify ${modify.length}+${modifyText.length}, tab math ${mathCmds.length}, tab text ${textCmds.length}, skipped ${skipped.join(" ")}`);
