// LaTeX → SVG with MathJax. Every formula is a self-contained SVG whose glyphs
// are paths in MathJax's TeX fonts: it looks like LaTeX in any page and any
// browser, with no web fonts to load (a page's CSP or font settings can't get
// in the way, as they could with MathML in the browser's math font).
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

/** What the containers of rendered math need (MathJax's own stylesheet isn't in the page). */
export const MATH_CSS = `
mjx-container { display: inline-block; line-height: 0; text-align: left; }
mjx-container > svg { overflow: visible; min-height: 1px; min-width: 1px; }
mjx-container > svg a { fill: currentColor; stroke: currentColor; }
`;

type Converter = (latex: string, display: boolean) => string;
let convert: Converter | null = null;

function converter(): Converter {
  if (!convert) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", {
      InputJax: new TeX({
        // errors are thrown, not drawn in red: a half-typed formula keeps its last good render
        packages: AllPackages.filter((p: string) => p !== "noerrors" && p !== "noundefined"),
        formatError: (_jax: unknown, err: Error) => {
          throw err;
        },
      }),
      // glyph paths inside each SVG, so each one stands on its own
      OutputJax: new SVG({ fontCache: "local" }),
    });
    convert = (latex, display) =>
      adaptor.outerHTML(doc.convert(latex, { display, em: 16, ex: 8, containerWidth: 80 * 16 }) as never);
  }
  return convert;
}

const cache = new Map<string, string | null>();

/** Is `latex` rendered already (renderMath returns at once)? */
export function isRendered(latex: string, display = false): boolean {
  return cache.has((display ? "D" : "I") + latex);
}

/** SVG markup for `latex` (an <mjx-container>), or null when it doesn't parse (yet). */
export function renderMath(latex: string, display = false): string | null {
  const key = (display ? "D" : "I") + latex;
  if (!cache.has(key)) {
    // forget the oldest, not everything: a long document keeps scrolling back to formulas it showed
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    try {
      cache.set(key, converter()(latex, display));
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key)!;
}
