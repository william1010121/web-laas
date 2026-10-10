// LaTeX → MathML with KaTeX. MathML needs no web fonts, so it renders inside any
// page; Unicode letters stand in for the mathvariants Chrome ignores.
import katex from "katex";
import { fixMathvariants } from "../cheatsheet/mathvariant";

const cache = new Map<string, string | null>();

/** MathML markup for `latex`, or null when it doesn't parse (yet). */
export function renderMath(latex: string, display = false): string | null {
  const key = (display ? "D" : "I") + latex;
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear();
    try {
      cache.set(
        key,
        fixMathvariants(katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: true, strict: "ignore" })),
      );
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key)!;
}
