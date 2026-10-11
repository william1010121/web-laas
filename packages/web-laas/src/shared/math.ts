// LaTeX → MathML with KaTeX. MathML needs no web fonts, so it renders inside any
// page; Unicode letters stand in for the mathvariants Chrome ignores.
import katex from "katex";
import { fixMathvariants } from "../cheatsheet/mathvariant";

/**
 * Chrome ignores MathML columnalign / columnspacing / rowspacing and pads every
 * cell instead: spell them out as CSS on each cell (aligned, cases, matrices…).
 */
export function alignColumns(mathml: string): string {
  if (!mathml.includes("<mtable")) return mathml;
  const list = (attrs: string, name: string, dflt: string) =>
    (new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? dflt).trim().split(/\s+/);
  const at = (xs: string[], i: number) => xs[Math.min(i, xs.length - 1)];
  const half = (len: string) => {
    const m = /^([\d.]+)([a-z]*)$/.exec(len);
    return m ? `${+m[1] / 2}${m[2] || "em"}` : "0";
  };
  let out = "";
  // one entry per open <mtable>: its alignments, gaps, row padding and the current column
  const tables: { align: string[]; gaps: string[]; row: string; col: number }[] = [];
  const re = /<(\/?)(mtable|mtr|mtd)\b([^>]*)>/g;
  let last = 0;
  for (let m; (m = re.exec(mathml)); ) {
    out += mathml.slice(last, m.index);
    last = re.lastIndex;
    const [tag, close, name, attrs] = m;
    if (name === "mtable") {
      if (close) tables.pop();
      else
        tables.push({
          align: list(attrs, "columnalign", "center"),
          gaps: list(attrs, "columnspacing", "0.8em"),
          // plus a little for the strut TeX puts in every row
          row: `calc(${half(list(attrs, "rowspacing", "1ex")[0])} + 0.15em)`,
          col: 0,
        });
    } else if (name === "mtr" && !close && tables.length) {
      tables[tables.length - 1].col = 0;
    } else if (name === "mtd" && !close && tables.length && !/style=/.test(attrs)) {
      const t = tables[tables.length - 1];
      const j = t.col++;
      const a = at(t.align, j);
      const left = j === 0 ? "0" : half(at(t.gaps, j - 1));
      const style = `padding:${t.row} ${half(at(t.gaps, j))} ${t.row} ${left}${a === "left" || a === "right" ? `;text-align:${a}` : ""}`;
      out += `<mtd${attrs} style="${style}">`;
      continue;
    }
    out += tag;
  }
  return out + mathml.slice(last);
}

/**
 * Math fonts by name, in front of the generic `math` family: browsers let users
 * map `math` to any font (Arc's ends up with a plain one), and without a math
 * font's OpenType MATH table a radical is a √ glyph with a loose bar over it.
 * STIX Two Math ships with macOS, Cambria Math with Windows.
 */
export const MATH_FONT_CSS = `math { font-family: "STIX Two Math", "Cambria Math", "Latin Modern Math", "Noto Sans Math", math; }`;

const cache = new Map<string, string | null>();

/** MathML markup for `latex`, or null when it doesn't parse (yet). */
export function renderMath(latex: string, display = false): string | null {
  const key = (display ? "D" : "I") + latex;
  if (!cache.has(key)) {
    // forget the oldest, not everything: a long document keeps scrolling back to formulas it showed
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
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
