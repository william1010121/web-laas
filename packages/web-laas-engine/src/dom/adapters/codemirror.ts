import { findFormulas, type FormulaSpan } from "../../core/formula";
import type { CaretRect, EditorAdapter } from "./types";

// ── CodeMirror 6 (Overleaf, JupyterLab 4, …) ───────────────────────────────
// We run in the page's main world, so the EditorView is reachable from the DOM.

interface CM6View {
  state: {
    doc: { length: number };
    selection: { main: { from: number; to: number; head: number } };
    sliceDoc(from: number, to: number): string;
  };
  dispatch(spec: unknown): void;
  focus(): void;
  dom: HTMLElement;
  coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null;
  posAtDOM?(node: Node, offset?: number): number;
}

export function findCM6View(el: Element): CM6View | null {
  const editor = el.closest(".cm-editor");
  if (!editor) return null;
  // Mirrors EditorView.findFromDOM: newer versions store `cmTile`, older ones `cmView`.
  const content = editor.querySelector(".cm-content") as (Element & { cmView?: any; cmTile?: any }) | null;
  const tile = content?.cmTile ?? (editor as any).cmTile;
  const cv = content?.cmView ?? (editor as any).cmView;
  const view = tile?.root?.view ?? cv?.rootView?.view ?? cv?.view ?? null;
  return view && typeof view.dispatch === "function" ? view : null;
}

export class CM6Adapter implements EditorAdapter {
  readonly kind = "cm6";
  constructor(private view: CM6View) {}
  get id() {
    return this.view;
  }
  getSelection() {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
  }
  getLength() {
    return this.view.state.doc.length;
  }
  textBefore(pos: number, max: number) {
    return this.view.state.sliceDoc(Math.max(0, pos - max), pos);
  }
  slice(from: number, to: number) {
    return this.view.state.sliceDoc(from, to);
  }
  replace(from: number, to: number, text: string, selFrom: number, selTo: number) {
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: selFrom, head: selTo },
      userEvent: "input",
      scrollIntoView: true,
    });
  }
  setSelection(from: number, to: number) {
    this.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  }
  caretRect(): CaretRect | null {
    // the selection's end, the position the controller reads the formula at
    const c = this.view.coordsAtPos(this.view.state.selection.main.to);
    return c && { left: c.left, top: c.top, bottom: c.bottom };
  }
  completionActive() {
    // tooltips live inside the editor unless the app moves them to <body>
    const doc = this.view.dom.ownerDocument;
    return !!(this.view.dom.querySelector(".cm-tooltip-autocomplete") ?? doc.querySelector(".cm-tooltip-autocomplete"));
  }
}

// ── CodeMirror 5 (HackMD, classic Jupyter Notebook, …) ─────────────────────

interface CM5Pos {
  line: number;
  ch: number;
}
interface CM5 {
  getCursor(which?: string): CM5Pos;
  indexFromPos(p: CM5Pos): number;
  posFromIndex(i: number): CM5Pos;
  getRange(a: CM5Pos, b: CM5Pos): string;
  replaceRange(text: string, a: CM5Pos, b: CM5Pos, origin?: string): void;
  setSelection(a: CM5Pos, b: CM5Pos): void;
  lastLine(): number;
  getLine(n: number): string;
  operation(fn: () => void): void;
  cursorCoords(start: boolean, mode: "window"): { left: number; top: number; bottom: number };
  indexFromPos(pos: CM5Pos): number;
  changeGeneration?(): number;
  getValue(): string;
  display?: { viewFrom?: number };
}

export function findCM5(el: Element): CM5 | null {
  const wrapper = el.closest(".CodeMirror") as (Element & { CodeMirror?: CM5 }) | null;
  return wrapper?.CodeMirror ?? null;
}

export class CM5Adapter implements EditorAdapter {
  readonly kind = "cm5";
  constructor(private cm: CM5) {}
  get id() {
    return this.cm;
  }
  getSelection() {
    return {
      from: this.cm.indexFromPos(this.cm.getCursor("from")),
      to: this.cm.indexFromPos(this.cm.getCursor("to")),
    };
  }
  getLength() {
    const last = this.cm.lastLine();
    return this.cm.indexFromPos({ line: last, ch: this.cm.getLine(last).length });
  }
  textBefore(pos: number, max: number) {
    return this.slice(Math.max(0, pos - max), pos);
  }
  slice(from: number, to: number) {
    return this.cm.getRange(this.cm.posFromIndex(from), this.cm.posFromIndex(to));
  }
  replace(from: number, to: number, text: string, selFrom: number, selTo: number) {
    const cm = this.cm;
    cm.operation(() => {
      cm.replaceRange(text, cm.posFromIndex(from), cm.posFromIndex(to), "+input");
      cm.setSelection(cm.posFromIndex(selFrom), cm.posFromIndex(selTo));
    });
  }
  setSelection(from: number, to: number) {
    this.cm.setSelection(this.cm.posFromIndex(from), this.cm.posFromIndex(to));
  }
  completionActive() {
    return !!document.querySelector(".CodeMirror-hints");
  }
  caretRect(): CaretRect {
    const c = this.cm.cursorCoords(false, "window");
    return { left: c.left, top: c.top, bottom: c.bottom };
  }
}

/** A paragraph's formulas, worked out once per document version. */
interface ScannedParagraph {
  from: number;
  to: number;
  spans: FormulaSpan[];
}

/** Scanned paragraphs per document version (a CodeMirror 6 doc, or a CodeMirror 5 editor + generation). */
const scanned = new WeakMap<object, { version: unknown; comments: boolean; paragraphs: ScannedParagraph[] }>();

const CHUNK = 65536;
const BLANK = /\n[ \t]*\n/g;

/** Where the paragraph around `pos` starts and ends (blank lines bound it), reading in chunks. */
function paragraphAround(read: (from: number, to: number) => string, length: number, pos: number) {
  let from = 0;
  for (let end = pos; end > 0; end -= CHUNK) {
    // (overlap a little so a blank line across two chunks is seen)
    const start = Math.max(0, end - CHUNK);
    const text = read(start, Math.min(length, end + 2));
    let cut = -1;
    for (const m of text.matchAll(BLANK)) if (start + m.index + m[0].length <= pos) cut = start + m.index + m[0].length;
    if (cut >= 0) {
      from = cut;
      break;
    }
  }
  let to = length;
  for (let start = pos; start < length; start += CHUNK) {
    const text = read(Math.max(0, start - 2), Math.min(length, start + CHUNK));
    // (from a little before, for a blank line across two chunks; one ending by pos is the one before it)
    const base = Math.max(0, start - 2);
    const m = [...text.matchAll(BLANK)].find((m) => base + m.index + m[0].length > pos);
    if (m) {
      to = base + m.index;
      break;
    }
  }
  return { from, to };
}

/**
 * The start of the formula that is open at `pos`, from its opener to `pos`
 * ("" if none): what text resuming at `pos` needs to be read right. The
 * paragraph is read back to its real start, however long, and its formulas are
 * remembered for this document version.
 */
export function openAt(
  key: object,
  version: unknown,
  read: (from: number, to: number) => string,
  length: number,
  pos: number,
  comments: boolean,
): string {
  let cache = scanned.get(key);
  if (!cache || cache.version !== version || cache.comments !== comments) {
    scanned.set(key, (cache = { version, comments, paragraphs: [] }));
  }
  let para = cache.paragraphs.find((p) => p.from <= pos && pos <= p.to);
  if (!para) {
    const { from, to } = paragraphAround(read, length, pos);
    para = { from, to, spans: findFormulas(read(from, to), { comments }) };
    cache.paragraphs.push(para);
  }
  const at = pos - para.from;
  const open = para.spans.find((f) => f.from < at && at < f.to);
  return open ? read(para.from + open.from, pos) : "";
}

/**
 * CodeMirror draws only the lines near the window. For each place in `el`
 * (a .cm-content or .CodeMirror-code) where drawn lines resume after undrawn
 * ones, in DOM order: the start of a formula left open there (from its opener
 * to that place; "" if none), so the drawn text can be read right. Null if
 * `el` isn't one. `comments`: % starts a LaTeX comment.
 */
export function undrawnParagraphs(el: Element, opts: { comments?: boolean } = {}): string[] | null {
  const comments = !!opts.comments;
  const view = findCM6View(el);
  if (view && el.classList.contains("cm-content")) {
    const doc = view.state.doc;
    const read = (a: number, b: number) => view.state.sliceDoc(a, b);
    return [...el.querySelectorAll(":scope > .cm-gap")].map((gap) => {
      const next = gap.nextElementSibling;
      const pos = next && view.posAtDOM ? view.posAtDOM(next, 0) : -1;
      return pos > 0 ? openAt(doc, doc, read, doc.length, pos, comments) : "";
    });
  }
  const cm = findCM5(el);
  if (cm && el.classList.contains("CodeMirror-code")) {
    const line = cm.display?.viewFrom ?? 0;
    if (line <= 0) return [];
    const pos = cm.indexFromPos({ line, ch: 0 });
    const read = (a: number, b: number) => cm.getRange(cm.posFromIndex(a), cm.posFromIndex(b));
    const length = cm.indexFromPos({ line: cm.lastLine() + 1, ch: 0 });
    return [openAt(cm, cm.changeGeneration?.() ?? cm.getValue().length, read, length, pos, comments)];
  }
  return null;
}
