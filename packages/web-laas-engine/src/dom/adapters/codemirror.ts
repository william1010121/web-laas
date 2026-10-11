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

/** How far back an undrawn paragraph is looked at (a longer one is taken from this point). */
const PARAGRAPH_LIMIT = 20000;

/** The paragraph's text before `pos`, from the text before it. */
function paragraphTail(before: string): string {
  let cut = 0;
  for (const m of before.matchAll(/\n[ \t]*\n/g)) cut = m.index + m[0].length;
  return before.slice(cut);
}

/**
 * CodeMirror draws only the lines near the window. For each place in `el`
 * (a .cm-content or .CodeMirror-code) where drawn lines resume after undrawn
 * ones, in DOM order, the text of that paragraph before it: enough to tell
 * whether the drawn text starts inside a formula. Null if `el` isn't one.
 */
export function undrawnParagraphs(el: Element): string[] | null {
  const view = findCM6View(el);
  if (view && el.classList.contains("cm-content")) {
    return [...el.querySelectorAll(":scope > .cm-gap")].map((gap) => {
      const next = gap.nextElementSibling;
      const pos = next && view.posAtDOM ? view.posAtDOM(next, 0) : -1;
      return pos > 0 ? paragraphTail(view.state.sliceDoc(Math.max(0, pos - PARAGRAPH_LIMIT), pos)) : "";
    });
  }
  const cm = findCM5(el);
  if (cm && el.classList.contains("CodeMirror-code")) {
    const line = cm.display?.viewFrom ?? 0;
    if (line <= 0) return [];
    const pos = cm.indexFromPos({ line, ch: 0 });
    return [paragraphTail(cm.getRange(cm.posFromIndex(Math.max(0, pos - PARAGRAPH_LIMIT)), { line, ch: 0 }))];
  }
  return null;
}
