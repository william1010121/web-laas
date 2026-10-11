// Rendered formulas in place: every formula the caret isn't in is covered by
// its typeset version, drawn on a layer above the editor (the editor's own text
// can't change). Move the caret into one, or click it, and the source shows.
import { findFormulas, type FormulaSpan } from "web-laas-engine";
import { isRendered, MATH_CSS, renderMath } from "../shared/math";
import { prepareLatex } from "./preview";

const EDITORS = ".cm-content, .CodeMirror-code, textarea, input[type=text], input[type=search], input:not([type]), [contenteditable]";

/** A plain text field: a textarea, or a one-line text / search input. */
type Field = HTMLTextAreaElement | HTMLInputElement;
const isField = (el: Element): el is Field =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (el.type === "text" || el.type === "search"));

// Elements that start a new line of text.
const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "TABLE",
  "TD", "TH", "TR", "UL",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
const CODE = new Set(["CODE", "PRE", "KBD", "SAMP"]);
const SKIP_CLASSES = ["CodeMirror-gutter-wrapper", "CodeMirror-linewidget", "CodeMirror-widget"];

// Styles that decide where a text field wraps, copied onto its hidden mirror.
const MIRRORED = [
  "direction", "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant",
  "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign",
  "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "wordBreak", "overflowWrap",
] as const;

const CSS = `
:host { all: initial; }
${MATH_CSS}
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.layer > .boxes { position: absolute; left: 0; top: 0; }
.box {
  position: absolute; left: 0; top: 0; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px; white-space: nowrap;
}
.m { display: inline-block; line-height: normal; }

`;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A formula to draw: where it goes and what it looks like. */
interface Item {
  html: string;
  /** inline math (left-aligned in its box); display math is centred */
  inline: boolean;
  /** the editor's on-screen scale (its font size is in CSS px) */
  scale: number;
  box: Rect;
  clip: Rect;
  color: string;
  background: string;
  fontSize: string;
}

/** The text of a rich editor, line by line, with the text nodes it came from. */
interface DomText {
  text: string;
  segs: { node: Text; start: number }[];
  /** offsets where text resumes after a part the editor hasn't drawn (its paragraph may be cut) */
  resumes: number[];
}

export function domText(root: Element): DomText {
  // built from parts, joined once: asking a long string being built up for its
  // last character makes it copy itself every time
  const parts: string[] = [];
  let len = 0;
  let last = "";
  const add = (str: string) => {
    parts.push(str);
    len += str.length;
    last = str[str.length - 1];
  };
  const segs: DomText["segs"] = [];
  const resumes: number[] = [];
  const walk = (el: Element) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        const data = (n as Text).data;
        if (!data || /^\u200b+$/.test(data)) continue; // CodeMirror 5's empty-line filler
        segs.push({ node: n as Text, start: len });
        add(data);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const e = n as HTMLElement;
      const cls = e.classList;
      if (cls.contains("cm-gap")) {
        // CodeMirror 6 leaves far-off lines out: what follows starts a fresh paragraph
        add("\n\n");
        resumes.push(len);
        continue;
      }
      if (SKIP.has(e.tagName) || SKIP_CLASSES.some((c) => cls.contains(c))) continue;
      if (e.tagName === "BR") {
        if (e.nextSibling) add("\n"); // a trailing <br> only holds an empty line open
        continue;
      }
      if (e.getAttribute("contenteditable") === "false" || e.tagName === "IMG") {
        add("\ufffc"); // a widget: nothing to read, but it isn't nothing
        continue;
      }
      // code in a rich editor (<code>, <pre>: Markdown already turned into blocks) holds no math;
      // CodeMirror 5's lines are <pre> too, but those are text
      if (CODE.has(e.tagName) && !cls.contains("CodeMirror-line")) {
        const block = e.tagName === "PRE";
        if (block && len && last !== "\n") add("\n");
        add(block ? "\ufffc\n" : "\ufffc");
        continue;
      }
      const block = BLOCKS.has(e.tagName) || cls.contains("cm-line");
      if (block && len && last !== "\n") add("\n");
      const before = len;
      walk(e);
      // an empty block is an empty line
      if (block && (last !== "\n" || len === before)) add("\n");
    }
  };
  walk(root);
  return { text: parts.join(""), segs, resumes };
}

/** The DOM point at a text offset (the start of a range when !end). */
function point(t: DomText, pos: number, end: boolean): [Text, number] | null {
  const { segs } = t;
  if (!segs.length) return null;
  let lo = 0;
  let hi = segs.length - 1;
  // the last segment that starts before pos (or at it, for a range start)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (end ? segs[mid].start < pos : segs[mid].start <= pos) lo = mid;
    else hi = mid - 1;
  }
  let seg = segs[lo];
  let off = Math.min(Math.max(0, pos - seg.start), seg.node.data.length);
  if (!end && off === seg.node.data.length && segs[lo + 1]) {
    seg = segs[lo + 1];
    off = 0;
  }
  return [seg.node, off];
}

/**
 * Formulas in `text`, which resumes after undrawn stretches at `resumes`. The
 * paragraph right after one may begin inside a formula: with its undrawn start
 * (`undrawn[i]` for `resumes[i]`) it's read from there; without, it's left out.
 */
export function formulasIn(text: string, comments: boolean, resumes: number[], undrawn?: (string | undefined)[]) {
  const from = [0, ...resumes];
  return from.flatMap((start, i) => {
    const end = from[i + 1] ?? text.length;
    const head = i > 0 ? undrawn?.[i - 1] : "";
    if (head === undefined) {
      const blank = text.slice(start, end).search(/\n[ \t]*\n/);
      if (blank < 0) return [];
      const s = start + blank;
      return findFormulas(text.slice(s, end), { comments }).map((f) => ({ ...f, from: f.from + s, to: f.to + s }));
    }
    // a formula that starts in the undrawn part isn't drawn here
    const shift = start - head.length;
    return findFormulas(head + text.slice(start, end), { comments })
      .filter((f) => f.from >= head.length)
      .map((f) => ({ ...f, from: f.from + shift, to: f.to + shift }));
  });
}

/** The height of a line of text in `el`, in px. */
function lineHeightOf(el: Element): number {
  const cs = getComputedStyle(el);
  return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 0;
}

/** The element above `el`, stepping out of a shadow root to its host. */
function up(el: Element): Element | null {
  return el.parentElement ?? ((el.parentNode as ShadowRoot | null)?.host ?? null);
}

/** The document or shadow root `el` is in (where its focus and selection live). */
function scopeOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : el.ownerDocument;
}

const intersect = (a: Rect, b: Rect): Rect => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});
const empty = (r: Rect) => r.right - r.left < 1 || r.bottom - r.top < 1;

function parseAlpha(color: string): number {
  if (color === "transparent") return 0;
  const m = /rgba?\(([^)]*)\)/.exec(color);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? parseFloat(parts[3]) : 1;
}

/** The background behind `el`, see-through layers (an active-line tint) over the first solid one. */
function backgroundOf(el: Element | null): string {
  const layers: string[] = [];
  for (let a: Element | null = el; a; a = up(a)) {
    const c = getComputedStyle(a).backgroundColor;
    const alpha = parseAlpha(c);
    if (alpha >= 1) return [...layers.map((l) => `linear-gradient(${l}, ${l})`), c].join(", ");
    if (alpha > 0) layers.push(c);
  }
  return [...layers.map((l) => `linear-gradient(${l}, ${l})`), "Canvas"].join(", ");
}

/** The elements that cut off what of `el` shows: scroll containers around it, and itself if it scrolls. */
export function clippersOf(el: Element): Element[] {
  const out: Element[] = [];
  for (let a: Element | null = el; a && a !== el.ownerDocument.documentElement; a = up(a)) {
    const cs = getComputedStyle(a);
    const scrolls = [cs.overflowX, cs.overflowY, cs.overflow].some((v) => v && v !== "visible");
    if (isField(a) || scrolls) out.push(a);
  }
  return out;
}

/** How much an ancestor's transform scales `el` on screen (1 almost always). */
function scaleOf(el: Element, rect = el.getBoundingClientRect()): { sx: number; sy: number } {
  const h = el as HTMLElement;
  return {
    sx: h.offsetWidth ? rect.width / h.offsetWidth : 1,
    sy: h.offsetHeight ? rect.height / h.offsetHeight : 1,
  };
}

/** The part of the window where content inside all of `clippers` can show. */
function visibleArea(view: Window, clippers: Element[]): Rect {
  let r: Rect = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
  for (const a of clippers) {
    const b = a.getBoundingClientRect();
    // client sizes are in CSS px; the rect is on screen (a scaled ancestor shrinks it)
    const { sx, sy } = scaleOf(a, b);
    const left = b.left + a.clientLeft * sx;
    const top = b.top + a.clientTop * sy;
    r = intersect(r, { left, top, right: left + a.clientWidth * sx, bottom: top + a.clientHeight * sy });
  }
  return r;
}

const set = (v: string) => !!v && v !== "none" && v !== "normal" && v !== "auto";

/** Does `el` start a stacking context of its own? */
function formsContext(el: Element, cs: CSSStyleDeclaration): boolean {
  const parent = up(el);
  const flexItem = !!parent && /flex|grid/.test(getComputedStyle(parent).display);
  return (
    (cs.zIndex !== "auto" && !!cs.zIndex && (cs.position !== "static" || flexItem)) ||
    cs.position === "fixed" ||
    cs.position === "sticky" ||
    parseFloat(cs.opacity) < 1 ||
    set(cs.transform) ||
    set(cs.filter) ||
    set(cs.perspective) ||
    cs.isolation === "isolate" ||
    set(cs.mixBlendMode) ||
    /\b(paint|layout|strict|content)\b/.test(cs.contain || "") ||
    /transform|opacity|filter|perspective/.test(cs.willChange || "")
  );
}

/**
 * Where a layer over `el` goes so it paints just above it and below whatever
 * paints above it (an autocomplete list, a dialog): the stacking context `el`
 * paints in, at `el`'s level there. z-index only means something within one
 * context, so the layer has to be in the same one.
 */
export function stackingFor(el: Element): { context: Element; z: number } {
  const root = el.ownerDocument.documentElement;
  const contextOf = (from: Element | null) => {
    let a = from;
    while (a && a !== root && !formsContext(a, getComputedStyle(a))) a = up(a);
    return a && a !== root ? a : root;
  };
  const own = contextOf(el);
  if (own !== el) {
    // inside a container's context: in it, above the editor's text. That text may sit on a
    // level of its own there (CodeMirror 5's lines are z-index: 2): the outermost stacking
    // context between some text of the editor and the editor gives it
    let z = 0;
    const text = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) =>
      (n as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    ).nextNode();
    for (let a: Element | null = text?.parentElement ?? null; a && a !== own; a = up(a)) {
      const cs = getComputedStyle(a);
      if (formsContext(a, cs)) z = parseInt(cs.zIndex, 10) || 0;
      if (a === el) break;
    }
    return { context: own, z };
  }
  // the editor is a stacking context itself: beside it, at its level, in the one around it
  return { context: contextOf(up(el)), z: parseInt(getComputedStyle(el).zIndex, 10) || 0 };
}

/** Index of the first of `n` top-to-bottom items whose bottom reaches `top`. */
function firstReaching(n: number, bottomOf: (i: number) => number, top: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) < top) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Formulas this far outside the visible area are drawn too, so a scroll doesn't show them late. */
const MARGIN = 120;
/** How often (ms) an unchanged editor's scroll containers and stacking are looked at again. */
const RECHECK = 1000;
/** An editor whose text takes longer than this (ms) to read is read at most every READ_EVERY ms while it changes. */
const SLOW_READ = 12;
/** The style values last written to each box. */
const written = new WeakMap<HTMLElement, Record<string, string>>();

/** Set inline styles on `el`, skipping those that already have the value. */
function setStyles(el: HTMLElement, styles: Record<string, string>) {
  let prev = written.get(el);
  if (!prev) written.set(el, (prev = {}));
  const st = el.style as unknown as Record<string, string>;
  for (const k in styles) {
    if (prev[k] !== styles[k]) {
      st[k] = styles[k];
      prev[k] = styles[k];
    }
  }
}

/** Formulas rendered ahead (when idle) on each side of the ones on screen. */
const PREFETCH = 40;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
/** Time (ms) a frame may spend rendering formulas it hasn't drawn before. */
const RENDER_BUDGET = 8;
/** How often (ms) the page is searched for new open shadow roots. */
const SHADOW_SCAN = 2000;
const READ_EVERY = 200;

/** A hidden copy of a text field's text, in pieces of a few lines each. */
interface Mirror {
  el: HTMLElement;
  sig: string;
  value: string;
  pieces: { start: number; text: Text }[];
}

/** Lines per piece of a text field's mirror. */
const PIECE_LINES = 32;

/** `text` cut after every PIECE_LINES-th line break (a line break that ends a piece ends its block too). */
export function splitPieces(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let lines = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
    if (++lines === PIECE_LINES) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
      lines = 0;
    }
  }
  if (start < text.length || !out.length) out.push(text.slice(start));
  return out;
}

/** What is known about an editor between frames. Only its content changing makes it stale. */
interface RootState {
  stale: boolean;
  /** rich editors: the text and its nodes */
  dom: DomText | null;
  /** text fields: the value the formulas come from */
  value: string | null;
  formulas: FormulaSpan[];
  /** rendered SVG per formula, filled in as formulas come into view */
  html: (string | null | undefined)[];
  clippers: Element[];
  stacking: { context: Element; z: number };
  checked: number;
  generation: number;
  /** how long reading the text took last time, and when that was */
  cost: number;
  readAt: number;
  /** the boxes drawn for it last frame (kept as they are while a slow read waits) */
  drawn: { html: string; box: HTMLElement }[];
  /** the formulas drawn last frame, [from, to): their neighbours are rendered ahead when idle */
  near: [number, number];
}

/** Where boxes are drawn: a host element placed in the page's stacking, with a shadow root. */
interface Layer {
  host: HTMLElement;
  /** fills the window (or the transformed context it is fixed to) */
  frame: HTMLElement;
  /** holds the boxes */
  el: HTMLElement;
  /** window coordinates → the layer's own: x' = (x - left) / sx (a transformed context moves and scales it) */
  left: number;
  top: number;
  sx: number;
  sy: number;
}

/** Per-frame measurements of the editor itself. */
interface Frame {
  area: Rect;
  /** the editor's on-screen scale (a transformed ancestor) */
  sx: number;
  sy: number;
  contentLeft: number;
  contentRight: number;
  color: string;
  fontSize: string;
}

export class InlineRender {
  private on = false;
  private comments = false;
  /** bumped when the rules for finding formulas change: every editor's formulas are stale */
  private generation = 0;
  private frame = 0;
  private timer = 0;
  private laterTimer = 0;
  /** layers by the stacking context they're in, then z-index */
  private layers = new Map<Element, Map<number, Layer>>();
  /** boxes on screen, by the SVG they show (a box moves with its formula as text is typed before it) */
  private boxes = new Map<string, HTMLElement[]>();
  private states = new WeakMap<Element, RootState>();
  private mirrors = new Map<Field, Mirror>();
  private observer: MutationObserver;
  // per-frame memos of computed styles
  private backgrounds = new Map<Element, string>();
  private lineHeights = new Map<Element, number>();
  private toFit: { math: HTMLElement; w: number; h: number }[] = [];
  /** new formulas are rendered until then in a frame; the rest wait for the next one */
  private renderUntil = 0;
  private unfinished = false;
  /** editors drawn last frame, and the idle callback rendering their formulas ahead */
  private drawnStates: RootState[] = [];
  private idle = 0;
  /** open shadow roots on the page (editors can live in them), looked for every SHADOW_SCAN ms */
  private shadows = new Set<ShadowRoot>();
  private shadowScan = -Infinity;

  constructor(
    private doc: Document,
    private opts: {
      /** for a CodeMirror element, the formula left open at each place its drawn lines resume (see undrawnParagraphs) */
      undrawn?: (root: Element, comments: boolean) => string[] | null;
      /** false once this script is orphaned (extension updated): it then stops for good */
      alive?: () => boolean;
    } = {},
  ) {
    this.observer = new MutationObserver((records) => {
      // only an editor whose content changed has to read its text again
      const seen = new Set<Node>();
      for (const r of records) {
        for (let n: Node | null = r.target; n && !seen.has(n); n = n.parentNode) {
          seen.add(n);
          const st = this.states.get(n as Element);
          if (st) {
            st.stale = true;
            break;
          }
        }
      }
      this.schedule();
    });
  }

  set(opts: { on: boolean; comments: boolean }) {
    if (opts.comments !== this.comments) {
      this.comments = opts.comments;
      this.generation++;
      this.schedule();
    }
    if (opts.on === this.on) return;
    this.on = opts.on;
    const doc = this.doc;
    const view = doc.defaultView!;
    if (this.on) {
      doc.addEventListener("scroll", this.schedule, { capture: true, passive: true });
      doc.addEventListener("selectionchange", this.schedule);
      doc.addEventListener("input", this.schedule, true);
      doc.addEventListener("focusin", this.schedule);
      doc.addEventListener("focusout", this.schedule);
      view.addEventListener("resize", this.schedule);
      this.observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, characterData: true });
      // layout can also move without any of the above (a sidebar sliding open)
      this.timer = view.setInterval(this.schedule, 700);
      this.schedule();
    } else {
      this.destroy();
    }
  }

  destroy() {
    const doc = this.doc;
    const view = doc.defaultView!;
    this.on = false;
    doc.removeEventListener("scroll", this.schedule, { capture: true });
    doc.removeEventListener("selectionchange", this.schedule);
    doc.removeEventListener("input", this.schedule, true);
    doc.removeEventListener("focusin", this.schedule);
    doc.removeEventListener("focusout", this.schedule);
    view.removeEventListener("resize", this.schedule);
    this.observer.disconnect();
    for (const sr of this.shadows) sr.removeEventListener("scroll", this.schedule, { capture: true });
    this.shadows.clear();
    this.shadowScan = -Infinity;
    view.clearInterval(this.timer);
    view.clearTimeout(this.laterTimer);
    this.laterTimer = 0;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    (view as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(this.idle);
    this.idle = 0;
    for (const byZ of this.layers.values()) for (const l of byZ.values()) l.host.remove();
    for (const m of this.mirrors.values()) m.el.remove();
    this.layers.clear();
    this.boxes.clear();
    this.mirrors.clear();
    this.states = new WeakMap();
  }

  readonly schedule = () => {
    if (!this.on || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.on) this.update();
    });
  };

  /** Find open shadow roots (new ones get watched like the document). */
  private findShadows() {
    const now = performance.now();
    if (now - this.shadowScan < SHADOW_SCAN) return;
    this.shadowScan = now;
    const look = (scope: Document | ShadowRoot) => {
      for (const el of scope.querySelectorAll("*")) {
        const sr = el.shadowRoot;
        if (!sr || el.hasAttribute("data-web-laas-render") || el.hasAttribute("data-web-laas-preview")) continue;
        if (!this.shadows.has(sr)) {
          this.shadows.add(sr);
          // mutations and scrolling inside don't reach the document's listeners
          this.observer.observe(sr, { childList: true, subtree: true, characterData: true });
          sr.addEventListener("scroll", this.schedule, { capture: true, passive: true });
        }
        look(sr);
      }
    };
    for (const sr of this.shadows) if (!sr.host.isConnected) this.shadows.delete(sr);
    look(this.doc);
  }

  /** Redraw now (also what every scheduled frame does). */
  update() {
    if (this.opts.alive && !this.opts.alive()) return this.destroy();
    this.findShadows();
    this.renderUntil = performance.now() + RENDER_BUDGET;
    this.unfinished = false;
    this.drawnStates = [];
    const old = this.boxes;
    this.boxes = new Map();
    this.backgrounds.clear();
    this.lineHeights.clear();
    if (this.doc.visibilityState !== "hidden") {
      for (const root of this.roots()) {
        try {
          this.drawRoot(root, old);
        } catch {
          // an editor mid-update: try again next frame
        }
      }
    }
    this.fitAll();
    if (this.unfinished) this.schedule();
    else this.prefetch();
    for (const list of old.values()) for (const box of list) box.remove();
    for (const [ta, m] of this.mirrors) {
      if (!ta.isConnected) {
        m.el.remove();
        this.mirrors.delete(ta);
      }
    }
  }

  /** The editors on screen. */
  private roots(): Element[] {
    const view = this.doc.defaultView!;
    const out: Element[] = [];
    const scopes: (Document | ShadowRoot)[] = [this.doc, ...this.shadows];
    for (const el of scopes.flatMap((sc) => [...sc.querySelectorAll<HTMLElement>(EDITORS)])) {
      if (el instanceof HTMLInputElement && !isField(el)) continue;
      if (isField(el)) {
        if (el.closest(".CodeMirror, .cm-editor, .monaco-editor") || el.disabled) continue;
      } else if (!el.classList.contains("CodeMirror-code")) {
        if (!el.isContentEditable || el.closest(".CodeMirror, .monaco-editor")) continue;
        // only the outermost editable element is an editor
        if (!el.classList.contains("cm-content") && el.parentElement?.isContentEditable) continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < view.innerHeight && r.right > 0 && r.left < view.innerWidth) out.push(el);
    }
    return out;
  }

  /**
   * The editor's formulas, read again only when its content changed; null while
   * a long text that keeps changing (typing) waits for its next read.
   */
  private state(root: Element): RootState | null {
    let st = this.states.get(root);
    if (!st) {
      st = {
        stale: true, dom: null, value: null, formulas: [], html: [], clippers: [], stacking: { context: root.ownerDocument.documentElement, z: 0 }, checked: -Infinity, generation: -1,
        cost: 0, readAt: -Infinity, drawn: [], near: [0, 0],
      };
      this.states.set(root, st);
    }
    const ta = isField(root) ? root : null;
    // (a text field's value changes without DOM mutations)
    if (st.generation !== this.generation || (ta && st.value !== ta.value)) st.stale = true;
    const now = performance.now();
    if (st.stale || now - st.checked > RECHECK) {
      st.clippers = clippersOf(root);
      st.stacking = stackingFor(root);
      st.checked = now;
    }
    if (!st.stale) return st;
    if (st.cost > SLOW_READ && now - st.readAt < READ_EVERY) {
      this.later(st.readAt + READ_EVERY - now);
      return null;
    }
    st.stale = false;
    st.readAt = now;
    try {
      this.read(root, st, ta);
    } finally {
      st.cost = performance.now() - now;
    }
    return st;
  }

  private read(root: Element, st: RootState, ta: Field | null) {
    st.generation = this.generation;
    st.html = [];
    if (ta) {
      st.value = ta.value;
      st.formulas = findFormulas(st.value, { comments: this.comments });
      return;
    }
    st.dom = domText(root);
    // CodeMirror 5 draws only the lines near the window; the first one drawn may be mid-paragraph
    const mover = root.classList.contains("CodeMirror-code") ? root.closest(".CodeMirror-lines")?.parentElement : null;
    if (mover && parseFloat(mover.style.top || "0") > 0) st.dom.resumes.unshift(0);
    let undrawn: string[] | null = null;
    if (st.dom.resumes.length) {
      try {
        undrawn = this.opts.undrawn?.(root, this.comments) ?? null;
      } catch {}
      if (undrawn?.length !== st.dom.resumes.length) undrawn = null; // drawn since: don't guess
    }
    st.formulas = formulasIn(st.dom.text, this.comments, st.dom.resumes, undrawn ?? undefined);
  }

  /** Run an update after `ms` (one pending at a time). */
  private later(ms: number) {
    if (this.laterTimer) return;
    this.laterTimer = this.doc.defaultView!.setTimeout(() => {
      this.laterTimer = 0;
      this.schedule();
    }, Math.max(0, ms));
  }

  private drawRoot(root: Element, old: Map<string, HTMLElement[]>) {
    const st = this.state(root);
    if (st) this.drawnStates.push(st);
    if (!st) {
      // keep last frame's boxes until the text is read again
      const prev = this.states.get(root)!;
      for (const { html, box } of prev.drawn) {
        const list = old.get(html);
        const i = list ? list.indexOf(box) : -1;
        if (i < 0) continue;
        list!.splice(i, 1);
        let keep = this.boxes.get(html);
        if (!keep) this.boxes.set(html, (keep = []));
        keep.push(box);
      }
      return;
    }
    st.drawn = [];
    if (!st.formulas.length) return;
    const area = visibleArea(this.doc.defaultView!, st.clippers);
    if (empty(area)) return;
    const r = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    const { sx, sy } = scaleOf(root, r);
    const contentLeft = r.left + root.clientLeft * sx;
    const frame: Frame = {
      area,
      sx,
      sy,
      contentLeft,
      contentRight: contentLeft + (root.clientWidth - parseFloat(cs.paddingRight || "0")) * sx,
      color: cs.color,
      fontSize: cs.fontSize,
    };
    const items = isField(root) ? this.fieldItems(root, st, frame) : this.domItems(root, st, frame);
    if (!items.length) return;
    const layer = this.layer(st.stacking);
    for (const item of items) st.drawn.push({ html: item.html, box: this.draw(layer, item, old) });
  }

  /** Is the editor focused (its caret is the one that counts)? */
  private focused(root: Element): boolean {
    if (root.classList.contains("CodeMirror-code")) return !!root.closest(".CodeMirror-focused");
    const active = scopeOf(root).activeElement;
    return !!active && (active === root || root.contains(active));
  }

  /**
   * The rendered SVG of formula `i`, worked out once per content change; null
   * if it doesn't parse, or (for now) if this frame's rendering time is used up.
   */
  private htmlOf(st: RootState, i: number): string | null {
    let html = st.html[i];
    if (html === undefined) {
      const f = st.formulas[i];
      const latex = prepareLatex({ latex: f.latex, caret: 0, env: f.env }, "").plain;
      // rendering a screenful of new formulas takes a while: spread it over frames
      if (!isRendered(latex, f.display) && performance.now() > this.renderUntil) {
        this.unfinished = true;
        return null;
      }
      html = st.html[i] = renderMath(latex, f.display);
    }
    return html;
  }

  private domItems(root: Element, st: RootState, frame: Frame): Item[] {
    const t = st.dom!;
    const fs = st.formulas;
    const range = (i: number) => {
      const a = point(t, fs[i].from, false);
      const b = point(t, fs[i].to, true);
      if (!a || !b) return null;
      const rg = this.doc.createRange();
      rg.setStart(...a);
      rg.setEnd(...b);
      return rg;
    };
    // only the formulas near the visible area: found by bisection, as they run top to bottom
    const { area } = frame;
    const first = firstReaching(fs.length, (i) => range(i)?.getBoundingClientRect().bottom ?? -Infinity, area.top - MARGIN);
    st.near = [first, fs.length];
    const focused = this.focused(root);
    // (an editor in a shadow root has its selection there)
    const scope = scopeOf(root) as Document & { getSelection?: () => Selection | null };
    const sel = focused ? (scope.getSelection?.() ?? this.doc.getSelection()) : null;
    const selRange = sel && sel.rangeCount && root.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
    // CodeMirror 5 draws its own caret and selection instead of the DOM's
    const cm5Marks =
      focused && root.classList.contains("CodeMirror-code")
        ? [...root.closest(".CodeMirror")!.querySelectorAll(".CodeMirror-cursor, .CodeMirror-selected")].map((e) => e.getBoundingClientRect())
        : [];
    const items: Item[] = [];
    for (let i = first; i < fs.length; i++) {
      const rg = range(i);
      if (!rg) continue;
      const rects = [...rg.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      if (!rects.length) continue;
      if (Math.min(...rects.map((r) => r.top)) > area.bottom + MARGIN) {
        st.near = [first, i];
        break;
      }
      if (selRange && rg.comparePoint(selRange.startContainer, selRange.startOffset) <= 0 && rg.comparePoint(selRange.endContainer, selRange.endOffset) >= 0) {
        // the caret (or selection) is in it: show the source. A caret touching it from
        // outside counts too, on purpose (as in Obsidian): arrowing up to a formula
        // shows its source before the caret goes in, and a formula just closed with
        // "$" isn't covered under the caret while typing goes on
        continue;
      }
      const host = rg.startContainer.parentElement ?? root;
      const box = this.boxFor(rects, fs[i].display, frame, this.lineHeightOf(host));
      if (!box) continue;
      if (cm5Marks.some((m) => m.right >= box.left && m.left <= box.right && m.bottom > box.top && m.top < box.bottom)) continue;
      const html = this.htmlOf(st, i);
      if (!html) continue;
      items.push({ html, inline: !fs[i].display, scale: frame.sy, box, clip: area, color: frame.color, background: this.backgroundOf(host), fontSize: frame.fontSize });
    }
    return items;
  }

  private fieldItems(ta: Field, st: RootState, frame: Frame): Item[] {
    const fs = st.formulas;
    const mirror = this.mirror(ta, st.value!);
    // the mirror is laid out unscaled; the field may be shown scaled (a transformed ancestor)
    const m = mirror.el.getBoundingClientRect();
    const t = ta.getBoundingClientRect();
    const { sx, sy } = frame;
    const toScreen = (r: DOMRect) =>
      new DOMRect(t.left + (r.left - m.left - ta.scrollLeft) * sx, t.top + (r.top - m.top - ta.scrollTop) * sy, r.width * sx, r.height * sy);
    const pieces = mirror.pieces;
    // the piece holding offset `pos` (the start of a range, or its end when `end`)
    const at = (pos: number, end: boolean): [Text, number] => {
      let lo = 0;
      let hi = pieces.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (end ? pieces[mid].start < pos : pieces[mid].start <= pos) lo = mid;
        else hi = mid - 1;
      }
      const p = pieces[lo];
      return [p.text, Math.min(Math.max(0, pos - p.start), p.text.data.length)];
    };
    const range = (i: number) => {
      const rg = this.doc.createRange();
      rg.setStart(...at(fs[i].from, false));
      rg.setEnd(...at(fs[i].to, true));
      return rg;
    };
    const { area } = frame;
    const first = firstReaching(fs.length, (i) => toScreen(range(i).getBoundingClientRect()).bottom, area.top - MARGIN);
    st.near = [first, fs.length];
    const focused = scopeOf(ta).activeElement === ta;
    const background = this.backgroundOf(ta);
    const lineHeight = this.lineHeightOf(ta);
    const items: Item[] = [];
    for (let i = first; i < fs.length; i++) {
      const f = fs[i];
      const rects = [...range(i).getClientRects()]
        .filter((r) => r.width > 0 || r.height > 0)
        .map(toScreen);
      if (!rects.length) continue;
      if (Math.min(...rects.map((r) => r.top)) > area.bottom + MARGIN) {
        st.near = [first, i];
        break;
      }
      // (on purpose, a caret touching the delimiters counts too, as in Obsidian: see domItems)
      if (focused && (ta.selectionStart ?? -1) <= f.to && (ta.selectionEnd ?? -1) >= f.from) continue;
      const box = this.boxFor(rects, f.display, frame, lineHeight);
      const html = box && this.htmlOf(st, i);
      if (!box || !html) continue;
      items.push({ html, inline: !f.display, scale: frame.sy, box, clip: area, color: frame.color, background, fontSize: frame.fontSize });
    }
    return items;
  }

  /** A hidden copy of the field's text, laid out the same way, to measure where formulas are. */
  private mirror(ta: Field, value: string): Mirror {
    const cs = getComputedStyle(ta);
    const input = ta instanceof HTMLInputElement;
    const wraps = !input && ta.getAttribute("wrap") !== "off" && !/^pre$|nowrap/.test(cs.whiteSpace);
    const sig = [ta.clientWidth, ta.clientHeight, cs.font, cs.padding, cs.letterSpacing, cs.tabSize, wraps].join("\u0000");
    let m = this.mirrors.get(ta);
    if (!m || m.sig !== sig || !m.el.isConnected) {
      m?.el.remove();
      const el = this.doc.createElement("div");
      const st = el.style as unknown as Record<string, string>;
      for (const p of MIRRORED) st[p] = cs[p as keyof CSSStyleDeclaration] as string;
      Object.assign(el.style, {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        top: "0",
        left: "-99999px",
        height: "auto",
        overflow: "hidden",
        whiteSpace: wraps ? "pre-wrap" : "pre",
        // its layout doesn't touch the page's
        contain: "layout style",
      });
      if (ta.clientWidth > 0) {
        el.style.boxSizing = "border-box";
        el.style.width = `${ta.clientWidth + parseFloat(cs.borderLeftWidth || "0") + parseFloat(cs.borderRightWidth || "0")}px`;
      }
      if (input) {
        // an input's one line sits in the middle of its box
        Object.assign(el.style, {
          height: `${ta.offsetHeight}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        });
      }
      el.setAttribute("data-web-laas-mirror", "");
      (this.doc.body ?? this.doc.documentElement).append(el);
      m = { el, sig, value: "", pieces: [] };
      this.mirrors.set(ta, m);
    }
    if (m.value !== value) this.syncMirror(m, value);
    return m;
  }

  /**
   * Bring the mirror's text up to `value`. It is kept in pieces of a few dozen
   * lines, and only the pieces an edit touched are replaced: typing in a long
   * field lays out a few lines again, not all of them.
   */
  private syncMirror(m: Mirror, value: string) {
    const old = m.value;
    const pieces = m.pieces;
    // the edit: what's the same at the start and at the end
    const max = Math.min(old.length, value.length);
    let pre = 0;
    while (pre < max && old.charCodeAt(pre) === value.charCodeAt(pre)) pre++;
    let suf = 0;
    while (suf < max - pre && old.charCodeAt(old.length - 1 - suf) === value.charCodeAt(value.length - 1 - suf)) suf++;
    // pieces [a, b) cover the edit; those from b on only move
    let a = pieces.length;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].start + pieces[i].text.data.length > pre) {
        a = i;
        break;
      }
    }
    // (an edit at the very end belongs to the last piece)
    if (a === pieces.length && a > 0) a--;
    let b = pieces.length;
    for (let i = pieces.length - 1; i > a && pieces[i].start >= old.length - suf; i--) b = i;
    const delta = value.length - old.length;
    const from = pieces[a]?.start ?? 0;
    const to = b < pieces.length ? pieces[b].start + delta : value.length;
    const made = splitPieces(value.slice(from, to)).map((text, i, all) => {
      const div = this.doc.createElement("div");
      const node = this.doc.createTextNode(text);
      div.append(node);
      return { start: from + all.slice(0, i).reduce((n, t) => n + t.length, 0), text: node };
    });
    const block = (t: Text) => t.parentNode as HTMLElement;
    const next = pieces[b] ? block(pieces[b].text) : null;
    for (const p of pieces.slice(a, b)) block(p.text).remove();
    for (const p of made) m.el.insertBefore(block(p.text), next);
    for (const p of pieces.slice(b)) p.start += delta;
    pieces.splice(a, b - a, ...made);
    m.value = value;
  }

  /** Where the rendered formula goes, given the source's line boxes; null to leave it be. */
  private boxFor(rects: DOMRect[], display: boolean, frame: Frame, lineHeight: number): Rect | null {
    const box: Rect = {
      // (CodeMirror 5's line elements reach into its gutter)
      left: Math.max(frame.contentLeft, Math.min(...rects.map((r) => r.left))) - 1,
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.min(frame.contentRight, Math.max(...rects.map((r) => r.right))) + 1,
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    const textHeight = Math.min(...rects.map((r) => r.height));
    if (box.bottom - box.top <= textHeight * 1.5) {
      // one line: take its full height (the text box is shorter than the line)
      // (plus a pixel: the top of a "$" can poke out of its text box)
      const grow = Math.max(1, (lineHeight * frame.sy - (box.bottom - box.top)) / 2);
      return { ...box, top: box.top - grow, bottom: box.bottom + grow };
    }
    // inline math wrapped onto two lines: a box around both would hide the text beside it
    if (!display) return null;
    // display math on lines of its own: cover them to the editor's right edge, the formula centred
    return { ...box, right: Math.max(box.right, frame.contentRight) };
  }

  private backgroundOf(el: Element): string {
    let bg = this.backgrounds.get(el);
    if (bg === undefined) this.backgrounds.set(el, (bg = backgroundOf(el)));
    return bg;
  }

  private lineHeightOf(el: Element): number {
    let h = this.lineHeights.get(el);
    if (h === undefined) this.lineHeights.set(el, (h = lineHeightOf(el)));
    return h;
  }

  /** The layer for a place in the page's stacking, made (and put there) the first time. */
  private layer({ context, z }: { context: Element; z: number }): Layer {
    let byZ = this.layers.get(context);
    if (!byZ) this.layers.set(context, (byZ = new Map()));
    let layer = byZ.get(z);
    if (!layer || !layer.host.isConnected) {
      const host = this.doc.createElement("div");
      host.setAttribute("data-web-laas-render", "");
      host.style.cssText = `all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: ${z};`;
      const shadow = host.attachShadow({ mode: "closed" });
      const style = this.doc.createElement("style");
      style.textContent = CSS;
      const frame = this.doc.createElement("div");
      frame.className = "layer";
      const boxes = this.doc.createElement("div");
      boxes.className = "boxes";
      frame.append(boxes);
      shadow.append(style, frame);
      // last in its context: of equal z-index, the later one paints on top
      context.append(host);
      layer = { host, frame, el: boxes, left: 0, top: 0, sx: 1, sy: 1 };
      byZ.set(z, layer);
    }
    // in a context with a transform, "fixed" is relative to it and it moves and scales the layer:
    // boxes are placed in the layer's own coordinates, worked out from where the frame ends up
    const r = layer.frame.getBoundingClientRect();
    const f = layer.frame;
    layer.left = r.left;
    layer.top = r.top;
    layer.sx = f.offsetWidth ? r.width / f.offsetWidth : 1;
    layer.sy = f.offsetHeight ? r.height / f.offsetHeight : 1;
    return layer;
  }

  private draw(layer: Layer, item: Item, old: Map<string, HTMLElement[]>): HTMLElement {
    // reuse a box showing the same formula: no new SVG, no measuring
    let box = old.get(item.html)?.pop();
    if (!box) {
      box = this.doc.createElement("div");
      box.className = "box";
      box.innerHTML = `<span class="m">${item.html}</span>`;
    }
    if (box.parentElement !== layer.el) layer.el.append(box);
    let list = this.boxes.get(item.html);
    if (!list) this.boxes.set(item.html, (list = []));
    list.push(box);
    // into the layer's coordinates (the same as the window's, unless a transform is in the way)
    const map = (r: Rect): Rect => ({
      left: (r.left - layer.left) / layer.sx,
      top: (r.top - layer.top) / layer.sy,
      right: (r.right - layer.left) / layer.sx,
      bottom: (r.bottom - layer.top) / layer.sy,
    });
    const { left, top, right, bottom } = map(item.box);
    const w = right - left;
    const h = bottom - top;
    // the editor's text as big as it shows: its own scale over the layer's (they differ when
    // the editor itself is transformed, as the layer sits beside it then)
    const fontSize = `${(parseFloat(item.fontSize) * item.scale) / layer.sy}px`;
    const c = map(item.clip);
    const inside = c.top <= top && c.left <= left && c.right >= right && c.bottom >= bottom;
    // styles are written only when they change: parsing gradients and insets for every box on
    // every frame of a scroll adds up
    setStyles(box, {
      transform: `translate(${left}px, ${top}px)`,
      // inline math starts where its source does; display math is centred
      justifyContent: item.inline ? "flex-start" : "center",
      width: `${w}px`,
      height: `${h}px`,
      color: item.color,
      background: item.background,
      fontSize,
      // cut off only by the editor's visible area (a formula may reach a little past its line)
      clipPath: inside ? "" : `inset(${c.top - top}px ${right - c.right}px ${bottom - c.bottom}px ${c.left - left}px)`,
      visibility: empty(intersect(item.box, item.clip)) ? "hidden" : "",
    });
    // a formula bigger than its source is shrunk to fit, once its size is known (see fitAll)
    const size = `${Math.round(w)}x${Math.round(h)}:${fontSize}`;
    if (box.dataset.size !== size) {
      box.dataset.size = size;
      const math = box.firstElementChild as HTMLElement | null;
      if (math) this.toFit.push({ math, w, h });
    }
    return box;
  }

  /**
   * When the page is idle, render the formulas just above and below the ones on
   * screen, so that scrolling to them finds them ready.
   */
  private prefetch() {
    const view = this.doc.defaultView as (Window & { requestIdleCallback?: (cb: (d: IdleDeadline) => void) => number }) | null;
    if (!view?.requestIdleCallback || this.idle) return;
    this.idle = view.requestIdleCallback((deadline) => {
      this.idle = 0;
      if (!this.on) return;
      this.renderUntil = Infinity;
      for (const st of this.drawnStates) {
        const [from, to] = st.near;
        const ahead = [...range(to, Math.min(st.formulas.length, to + PREFETCH)), ...range(Math.max(0, from - PREFETCH), from).reverse()];
        for (const i of ahead) {
          if (deadline.timeRemaining() < 2) return void this.prefetch();
          if (st.html[i] === undefined) this.htmlOf(st, i);
        }
      }
    });
  }

  /** Shrink the formulas waiting for it, measuring all of them in one layout pass. */
  private fitAll() {
    const fits = this.toFit;
    this.toFit = [];
    for (const f of fits) f.math.style.zoom = "1";
    // (layout sizes, in the layer's own units like the boxes: not scaled by a transformed context)
    const sizes = fits.map((f) => ({ width: f.math.offsetWidth, height: f.math.offsetHeight }));
    fits.forEach(({ math, w, h }, i) => {
      const mr = sizes[i];
      // a little taller than the line is fine: ink rarely reaches the next line's text
      const zoom = Math.min(1, mr.width ? (w - 2) / mr.width : 1, mr.height ? (h * 1.2) / mr.height : 1);
      if (zoom < 1) math.style.zoom = String(Math.max(zoom, 0.05));
    });
  }
}
