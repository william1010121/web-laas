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

type LiteNode = unknown;
type Converter = (latex: string, display: boolean) => LiteNode;
let convert: Converter | null = null;
let adaptor: ReturnType<typeof liteAdaptor>;

function converter(): Converter {
  if (!convert) {
    adaptor = liteAdaptor();
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
    convert = (latex, display) => doc.convert(latex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
  }
  return convert;
}

/** A typeset formula: MathJax's tree, and its markup once asked for. */
interface Typeset {
  node: LiteNode;
  html?: string;
}

const cache = new Map<string, Typeset | null>();

function typeset(latex: string, display: boolean): Typeset | null {
  const key = (display ? "D" : "I") + latex;
  if (!cache.has(key)) {
    // forget the oldest, not everything: a long document keeps scrolling back to formulas it showed
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    try {
      cache.set(key, { node: converter()(latex, display) });
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key)!;
}

/** Is `latex` rendered already (renderMath returns at once)? */
export function isRendered(latex: string, display = false): boolean {
  return cache.has((display ? "D" : "I") + latex);
}

/** Does `latex` typeset (it's typeset now, and kept for the next call)? */
export function mathParses(latex: string, display = false): boolean {
  return typeset(latex, display) !== null;
}

/** SVG markup for `latex` (an <mjx-container>), or null when it doesn't parse (yet). */
export function renderMath(latex: string, display = false): string | null {
  const t = typeset(latex, display);
  if (!t) return null;
  return (t.html ??= adaptor.outerHTML(t.node as never));
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * `latex` typeset as DOM nodes, built directly rather than parsed from markup:
 * pages that require Trusted Types (Gemini) refuse innerHTML.
 */
export function renderMathElement(latex: string, display = false, doc: Document = document): Element | null {
  const t = typeset(latex, display);
  if (!t) return null;
  const build = (node: never, svg: boolean): Node => {
    const kind = adaptor.kind(node);
    if (kind === "#text") return doc.createTextNode(adaptor.value(node));
    const inSvg = svg || kind === "svg";
    const el = inSvg ? doc.createElementNS(SVG_NS, kind) : doc.createElement(kind);
    for (const { name, value } of adaptor.allAttributes(node)) {
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (name.startsWith("xlink:")) el.setAttributeNS("http://www.w3.org/1999/xlink", name, value);
      else el.setAttribute(name, value);
    }
    for (const child of adaptor.childNodes(node)) el.append(build(child as never, inSvg));
    return el;
  };
  return build(t.node as never, false) as Element;
}
