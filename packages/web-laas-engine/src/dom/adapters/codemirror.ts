import type { EditorAdapter } from "./types";

// ── CodeMirror 6 (Overleaf, JupyterLab 4, …) ───────────────────────────────
// We run in the page's main world, so the EditorView is reachable from the DOM.

interface CM6View {
  state: {
    doc: { length: number };
    selection: { main: { from: number; to: number } };
    sliceDoc(from: number, to: number): string;
  };
  dispatch(spec: unknown): void;
  focus(): void;
  dom: HTMLElement;
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
}
