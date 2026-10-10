// LaTeX → MathML with KaTeX. MathML needs no web fonts, so it renders inside any
// page; Unicode letters stand in for the mathvariants Chrome ignores.
import katex from "katex";
import { fixMathvariants } from "../cheatsheet/mathvariant";

/** Chrome ignores MathML columnalign: spell it out as text-align on each cell (aligned, cases, matrices…). */
export function alignColumns(mathml: string): string {
  if (!mathml.includes("columnalign=")) return mathml;
  let out = "";
  // one entry per open <mtable>: its column alignments and the current column
  const tables: { align: string[]; col: number }[] = [];
  const re = /<(\/?)(mtable|mtr|mtd)\b([^>]*)>/g;
  let last = 0;
  for (let m; (m = re.exec(mathml)); ) {
    out += mathml.slice(last, m.index);
    last = re.lastIndex;
    const [tag, close, name, attrs] = m;
    if (name === "mtable") {
      if (close) tables.pop();
      else tables.push({ align: (/columnalign="([^"]*)"/.exec(attrs)?.[1] ?? "center").split(/\s+/), col: 0 });
    } else if (name === "mtr" && !close && tables.length) {
      tables[tables.length - 1].col = 0;
    } else if (name === "mtd" && !close && tables.length) {
      const t = tables[tables.length - 1];
      const a = t.align[Math.min(t.col++, t.align.length - 1)];
      if ((a === "left" || a === "right") && !/style=/.test(attrs)) {
        out += `<mtd${attrs} style="text-align:${a}">`;
        continue;
      }
    }
    out += tag;
  }
  return out + mathml.slice(last);
}

const cache = new Map<string, string | null>();

/** MathML markup for `latex`, or null when it doesn't parse (yet). */
export function renderMath(latex: string, display = false): string | null {
  const key = (display ? "D" : "I") + latex;
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear();
    try {
      cache.set(
        key,
        alignColumns(fixMathvariants(katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: true, strict: "ignore" }))),
      );
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key)!;
}
