// Pre-render each state's formula with KaTeX (HTML output, local fonts) so the
// composition only swaps markup at render time. Empty groups show as □ fields.
import katex from "katex";
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../assets/states.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
let last = "";
for (const s of data.states) {
  const m = /\$([^$]*)\$?/.exec(s.text);
  if (!m) {
    s.math = "";
    continue;
  }
  const tex = m[1].replace(/\{\}/g, "{\\textcolor{#4fb8aa}{\\square}}").trim();
  try {
    s.math = tex ? katex.renderToString(tex, { throwOnError: true, displayMode: true, output: "html" }) : "";
    last = s.math;
  } catch {
    s.math = last; // mid-trigger states (";", "x'") keep the last good render
  }
}
writeFileSync(file, JSON.stringify(data));
console.log("rendered", data.states.filter((s) => s.math).length, "formulas");
