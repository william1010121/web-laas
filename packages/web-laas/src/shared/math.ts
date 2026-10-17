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

/**
 * Typeset formulas, kept for the next time they're asked for. The markup (an SVG string) is
 * what most callers need and is kept for many formulas; MathJax's tree, from which DOM nodes
 * are built (renderMathElement), is several times bigger and kept for a few only.
 */
const MARKUP_KEPT = 2000;
const TREES_KEPT = 100;
/** markup by key; null: it doesn't parse */
const markup = new Map<string, string | null>();
const trees = new Map<string, LiteNode>();
/** formulas shown only in passing (the live preview's caret marker moving through one) */
const brief = new Map<string, string | null>();
const BRIEF_KEPT = 50;

const keyOf = (latex: string, display: boolean) => (display ? "D" : "I") + latex;

/** Add to a map that forgets its oldest entry past `max` (a long document keeps scrolling back). */
function keep<V>(map: Map<string, V>, key: string, value: V, max: number) {
  if (map.size >= max) map.delete(map.keys().next().value!);
  map.set(key, value);
}

/** MathJax's tree for `latex`, or null when it doesn't parse. */
function tree(latex: string, display: boolean): LiteNode | null {
  const key = keyOf(latex, display);
  if (markup.get(key) === null) return null;
  const t = trees.get(key);
  if (t) return t;
  try {
    const node = converter()(latex, display);
    keep(trees, key, node, TREES_KEPT);
    return node;
  } catch {
    keep(markup, key, null, MARKUP_KEPT);
    return null;
  }
}

/** Is `latex` rendered already (renderMath returns at once)? */
export function isRendered(latex: string, display = false): boolean {
  const key = keyOf(latex, display);
  return markup.has(key) || trees.has(key);
}

/** Does `latex` typeset (it's typeset now, and kept for the next call)? */
export function mathParses(latex: string, display = false): boolean {
  const known = markup.get(keyOf(latex, display));
  return known !== undefined ? known !== null : tree(latex, display) !== null;
}

/**
 * SVG markup for `latex` (an <mjx-container>), or null when it doesn't parse (yet).
 * `brief`: shown in passing (one caret position of many), kept apart so it doesn't push out
 * the formulas of the page.
 */
export function renderMath(latex: string, display = false, opts: { brief?: boolean } = {}): string | null {
  const key = keyOf(latex, display);
  const store = opts.brief ? brief : markup;
  const known = store.has(key) ? store.get(key) : markup.get(key);
  if (known !== undefined) return known;
  let html: string | null = null;
  try {
    // (not through tree(): a formula shown once needn't keep its tree)
    const node = trees.get(key) ?? converter()(latex, display);
    html = adaptor.outerHTML(node as never);
  } catch {}
  keep(store, key, html, opts.brief ? BRIEF_KEPT : MARKUP_KEPT);
  return html;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * `latex` typeset as DOM nodes, built directly rather than parsed from markup:
 * pages that require Trusted Types (Gemini) refuse innerHTML.
 */
export function renderMathElement(latex: string, display = false, doc: Document = document): Element | null {
  const t = tree(latex, display);
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
  return build(t as never, false) as Element;
}
