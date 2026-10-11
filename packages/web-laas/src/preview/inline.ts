// Rendered formulas in place: every formula the caret isn't in is covered by
// its typeset version, drawn on a layer above the editor (the editor's own text
// can't change). Move the caret into one, or click it, and the source shows.
import { findFormulas } from "web-laas-engine";
import { renderMath } from "../shared/math";
import { prepareLatex } from "./preview";

const EDITORS = ".cm-content, .CodeMirror-code, textarea, [contenteditable]";

// Elements that start a new line of text.
const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "TABLE",
  "TD", "TH", "TR", "UL",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
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
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.box {
  position: absolute; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px; white-space: nowrap;
}
.m { display: inline-block; line-height: normal; }
.box math { color: inherit; }
.box math[display="block"] { margin: 0; }
`;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A formula to draw: where it goes and what it looks like. */
interface Item {
  key: string;
  html: string;
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
  let text = "";
  const segs: DomText["segs"] = [];
  const resumes: number[] = [];
  const walk = (el: Element) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        const data = (n as Text).data;
        if (!data || /^​+$/.test(data)) continue; // CodeMirror 5's empty-line filler
        segs.push({ node: n as Text, start: text.length });
        text += data;
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const e = n as HTMLElement;
      if (e.classList.contains("cm-gap")) {
        // CodeMirror 6 leaves far-off lines out: what follows starts a fresh paragraph
        text += "\n\n";
        resumes.push(text.length);
        continue;
      }
      if (SKIP.has(e.tagName) || SKIP_CLASSES.some((c) => e.classList.contains(c))) continue;
      if (e.tagName === "BR") {
        if (e.nextSibling) text += "\n"; // a trailing <br> only holds an empty line open
        continue;
      }
      if (e.getAttribute("contenteditable") === "false" || e.tagName === "IMG") {
        text += "￼"; // a widget: nothing to read, but it isn't nothing
        continue;
      }
      const block = BLOCKS.has(e.tagName) || e.classList.contains("cm-line");
      if (block && text && !text.endsWith("\n")) text += "\n";
      const before = text.length;
      walk(e);
      // an empty block is an empty line
      if (block && (!text.endsWith("\n") || text.length === before)) text += "\n";
    }
  };
  walk(root);
  return { text, segs, resumes };
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

/** Formulas in `text`, leaving out a paragraph that may have lost its start. */
export function formulasIn(text: string, comments: boolean, resumes: number[]) {
  const from = [0, ...resumes];
  return from.flatMap((start, i) => {
    let s = start;
    if (i > 0) {
      // the paragraph right after an undrawn stretch may begin inside a formula
      const blank = text.slice(s).search(/\n[ \t]*\n/);
      if (blank < 0) return [];
      s += blank;
    }
    const end = from[i + 1] ?? text.length;
    return findFormulas(text.slice(s, end), { comments }).map((f) => ({ ...f, from: f.from + s, to: f.to + s }));
  });
}

/** The height of a line of text in `el`, in px. */
function lineHeightOf(el: Element): number {
  const cs = getComputedStyle(el);
  return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 0;
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
  for (let a = el; a; a = a.parentElement) {
    const c = getComputedStyle(a).backgroundColor;
    const alpha = parseAlpha(c);
    if (alpha >= 1) return [...layers.map((l) => `linear-gradient(${l}, ${l})`), c].join(", ");
    if (alpha > 0) layers.push(c);
  }
  return [...layers.map((l) => `linear-gradient(${l}, ${l})`), "Canvas"].join(", ");
}

/** The part of the window where `el`'s content can show (scroll containers cut it off). */
function visibleArea(el: Element): Rect {
  const view = el.ownerDocument.defaultView!;
  let r: Rect = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
  for (let a: Element | null = el; a && a !== el.ownerDocument.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (a !== el && cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    if (a === el && !(a instanceof HTMLTextAreaElement)) continue;
    const b = a.getBoundingClientRect();
    const left = b.left + a.clientLeft;
    const top = b.top + a.clientTop;
    r = intersect(r, { left, top, right: left + a.clientWidth, bottom: top + a.clientHeight });
  }
  return r;
}

/** The z-index that puts a layer just above `el` (the stacking context it paints in). */
function zIndexFor(el: Element): number {
  let z = 0;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const cs = getComputedStyle(a);
    const parent = a.parentElement && getComputedStyle(a.parentElement).display;
    const stacks = cs.position !== "static" || /flex|grid/.test(parent ?? "");
    if (cs.zIndex !== "auto" && stacks) z = parseInt(cs.zIndex, 10) || 0; // the outermost one wins
  }
  return z;
}

export class InlineRender {
  private on = false;
  private comments = false;
  private frame = 0;
  private timer = 0;
  private layers = new Map<number, HTMLElement>();
  private boxes = new Map<string, HTMLElement>();
  private ids = new WeakMap<Element, number>();
  private nextId = 1;
  private mirrors = new Map<HTMLTextAreaElement, { el: HTMLElement; text: Text; sig: string }>();
  private observer: MutationObserver;

  constructor(private doc: Document) {
    this.observer = new MutationObserver(this.schedule);
  }

  set(opts: { on: boolean; comments: boolean }) {
    const changed = opts.comments !== this.comments;
    this.comments = opts.comments;
    if (opts.on === this.on) {
      if (changed) this.schedule();
      return;
    }
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
    view.clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const host of this.layers.values()) host.remove();
    for (const m of this.mirrors.values()) m.el.remove();
    this.layers.clear();
    this.boxes.clear();
    this.mirrors.clear();
  }

  readonly schedule = () => {
    if (!this.on || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.on) this.update();
    });
  };

  /** Redraw now (also what every scheduled frame does). */
  update() {
    const seen = new Set<string>();
    if (this.doc.visibilityState !== "hidden") {
      for (const root of this.roots()) {
        let items: Item[];
        try {
          items = root instanceof HTMLTextAreaElement ? this.fieldItems(root) : this.domItems(root);
        } catch {
          continue; // an editor mid-update: try again next frame
        }
        if (!items.length) continue;
        const layer = this.layer(zIndexFor(root));
        for (const item of items) {
          seen.add(item.key);
          this.draw(layer, item);
        }
      }
    }
    for (const [key, box] of this.boxes) {
      if (!seen.has(key)) {
        box.remove();
        this.boxes.delete(key);
      }
    }
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
    for (const el of this.doc.querySelectorAll<HTMLElement>(EDITORS)) {
      if (el instanceof HTMLTextAreaElement) {
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

  private rootId(root: Element) {
    let id = this.ids.get(root);
    if (!id) this.ids.set(root, (id = this.nextId++));
    return id;
  }

  /** Is the editor focused (its caret is the one that counts)? */
  private focused(root: Element): boolean {
    if (root.classList.contains("CodeMirror-code")) return !!root.closest(".CodeMirror-focused");
    const active = this.doc.activeElement;
    return !!active && (active === root || root.contains(active));
  }

  private domItems(root: Element): Item[] {
    const t = domText(root);
    // CodeMirror 5 draws only the lines near the window; the first one drawn may be mid-paragraph
    const cm5 = root.classList.contains("CodeMirror-code");
    const mover = cm5 ? root.closest(".CodeMirror-lines")?.parentElement : null; // offset by the undrawn lines
    if (mover && parseFloat(mover.style.top || "0") > 0) t.resumes.unshift(0);
    const formulas = formulasIn(t.text, this.comments, t.resumes);
    if (!formulas.length) return [];
    const area = visibleArea(root);
    if (empty(area)) return [];
    const focused = this.focused(root);
    const sel = this.doc.getSelection();
    const selRange = focused && sel && sel.rangeCount && root.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
    // CodeMirror 5 draws its own caret and selection instead of the DOM's
    const cm5Marks =
      focused && cm5
        ? [...root.closest(".CodeMirror")!.querySelectorAll(".CodeMirror-cursor, .CodeMirror-selected")].map((e) => e.getBoundingClientRect())
        : [];
    const style = getComputedStyle(root);
    const id = this.rootId(root);
    const items: Item[] = [];
    for (const f of formulas) {
      const a = point(t, f.from, false);
      const b = point(t, f.to, true);
      if (!a || !b) continue;
      const range = this.doc.createRange();
      range.setStart(...a);
      range.setEnd(...b);
      if (selRange && range.comparePoint(selRange.startContainer, selRange.startOffset) <= 0 && range.comparePoint(selRange.endContainer, selRange.endOffset) >= 0) {
        continue; // the caret (or selection) is in it: show the source
      }
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      if (!rects.length) continue;
      const host = a[0].parentElement;
      const box = this.boxFor(rects, f.display, root, lineHeightOf(host ?? root));
      if (!box) continue;
      if (cm5Marks.some((m) => m.right >= box.left && m.left <= box.right && m.bottom > box.top && m.top < box.bottom)) continue;
      const html = this.html(f.latex, f.display, f.env);
      if (!html) continue;
      items.push({
        key: `${id}:${f.from}:${html}`,
        html,
        box,
        clip: area,
        color: style.color,
        background: backgroundOf(host),
        fontSize: style.fontSize,
      });
    }
    return items;
  }

  private fieldItems(ta: HTMLTextAreaElement): Item[] {
    const value = ta.value;
    const formulas = findFormulas(value, { comments: this.comments });
    if (!formulas.length) return [];
    const area = visibleArea(ta);
    if (empty(area)) return [];
    const { el: mirror, text } = this.mirror(ta);
    const m = mirror.getBoundingClientRect();
    const t = ta.getBoundingClientRect();
    const dx = t.left - m.left - ta.scrollLeft;
    const dy = t.top - m.top - ta.scrollTop;
    const focused = this.doc.activeElement === ta;
    const style = getComputedStyle(ta);
    const id = this.rootId(ta);
    const background = backgroundOf(ta);
    const items: Item[] = [];
    for (const f of formulas) {
      if (focused && ta.selectionStart <= f.to && ta.selectionEnd >= f.from) continue;
      const range = this.doc.createRange();
      range.setStart(text, f.from);
      range.setEnd(text, f.to);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0 || r.height > 0)
        .map((r) => new DOMRect(r.left + dx, r.top + dy, r.width, r.height));
      if (!rects.length) continue;
      const box = this.boxFor(rects, f.display, ta, lineHeightOf(ta));
      const html = box && this.html(f.latex, f.display, f.env);
      if (!box || !html) continue;
      items.push({ key: `${id}:${f.from}:${html}`, html, box, clip: area, color: style.color, background, fontSize: style.fontSize });
    }
    return items;
  }

  /** A hidden copy of the field's text, laid out the same way, to measure where formulas are. */
  private mirror(ta: HTMLTextAreaElement) {
    const cs = getComputedStyle(ta);
    const wraps = ta.getAttribute("wrap") !== "off" && !/^pre$|nowrap/.test(cs.whiteSpace);
    const sig = [ta.value, ta.clientWidth, cs.font, cs.padding, wraps].join("\u0000");
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
      });
      if (ta.clientWidth > 0) {
        el.style.boxSizing = "border-box";
        el.style.width = `${ta.clientWidth + parseFloat(cs.borderLeftWidth || "0") + parseFloat(cs.borderRightWidth || "0")}px`;
      }
      el.setAttribute("data-web-laas-mirror", "");
      const text = this.doc.createTextNode(ta.value + " ");
      el.append(text);
      (this.doc.body ?? this.doc.documentElement).append(el);
      m = { el, text, sig };
      this.mirrors.set(ta, m);
    }
    return m;
  }

  /** Where the rendered formula goes, given the source's line boxes; null to leave it be. */
  private boxFor(rects: DOMRect[], display: boolean, root: Element, lineHeight: number): Rect | null {
    const r = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    const contentLeft = r.left + root.clientLeft;
    const contentRight = contentLeft + root.clientWidth - parseFloat(cs.paddingRight || "0");
    const box: Rect = {
      // (CodeMirror 5's line elements reach into its gutter)
      left: Math.max(contentLeft, Math.min(...rects.map((r) => r.left))) - 1,
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.min(contentRight, Math.max(...rects.map((r) => r.right))) + 1,
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    const textHeight = Math.min(...rects.map((r) => r.height));
    if (box.bottom - box.top <= textHeight * 1.5) {
      // one line: take its full height (the text box is shorter than the line)
      // (plus a pixel: the top of a "$" can poke out of its text box)
      const grow = Math.max(1, (lineHeight - (box.bottom - box.top)) / 2);
      return { ...box, top: box.top - grow, bottom: box.bottom + grow };
    }
    // inline math wrapped onto two lines: a box around both would hide the text beside it
    if (!display) return null;
    // display math on lines of its own: cover them to the editor's right edge, the formula centred
    return { ...box, right: Math.max(box.right, contentRight) };
  }

  private html(latex: string, display: boolean, env?: string): string | null {
    return renderMath(prepareLatex({ latex, caret: 0, env }, "").plain, display);
  }

  private layer(z: number): HTMLElement {
    let layer = this.layers.get(z);
    if (!layer) {
      const host = this.doc.createElement("div");
      host.setAttribute("data-web-laas-render", "");
      host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${z};`;
      const shadow = host.attachShadow({ mode: "closed" });
      const style = this.doc.createElement("style");
      style.textContent = CSS;
      layer = this.doc.createElement("div");
      layer.className = "layer";
      shadow.append(style, layer);
      this.doc.documentElement.append(host);
      this.layers.set(z, layer);
    }
    return layer;
  }

  private draw(layer: HTMLElement, item: Item) {
    let box = this.boxes.get(item.key);
    if (!box || box.parentElement !== layer) {
      box?.remove();
      box = this.doc.createElement("div");
      box.className = "box";
      box.innerHTML = `<span class="m">${item.html}</span>`;
      layer.append(box);
      this.boxes.set(item.key, box);
    }
    const { left, top, right, bottom } = item.box;
    const w = right - left;
    const h = bottom - top;
    const s = box.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${w}px`;
    s.height = `${h}px`;
    s.color = item.color;
    s.background = item.background;
    s.fontSize = item.fontSize;
    const c = item.clip;
    s.clipPath = `inset(${Math.max(0, c.top - top)}px ${Math.max(0, right - c.right)}px ${Math.max(0, bottom - c.bottom)}px ${Math.max(0, c.left - left)}px)`;
    s.visibility = empty(intersect(item.box, c)) ? "hidden" : "";
    // shrink a formula bigger than its source to fit
    const size = `${Math.round(w)}x${Math.round(h)}:${item.fontSize}`;
    if (box.dataset.size !== size) {
      box.dataset.size = size;
      const math = box.firstElementChild as HTMLElement | null;
      if (math) {
        math.style.zoom = "1";
        const mw = math.getBoundingClientRect().width;
        const mh = math.getBoundingClientRect().height;
        // a little taller than the line is fine: ink rarely reaches the next line's text
        const zoom = Math.min(1, mw ? (w - 2) / mw : 1, mh ? (h * 1.2) / mh : 1);
        if (zoom < 1) math.style.zoom = String(Math.max(zoom, 0.05));
      }
    }
  }
}
