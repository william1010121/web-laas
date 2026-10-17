// The composer's editor: CodeMirror 6 with formulas typeset in place. A formula
// the caret isn't in is replaced by its rendering (the text really collapses to
// the formula's width); move the caret into it, or click it, and the source shows.
import { findFormulas } from "web-laas-engine";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder, runScopeHandlers, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { mathParses, renderMathElement } from "../shared/math";
import { prepareLatex } from "../preview/preview";

class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly display: boolean,
    readonly at: number,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.latex === this.latex && other.display === this.display && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = this.display ? "wl-math wl-display" : "wl-math";
    const math = renderMathElement(this.latex, this.display);
    if (math) span.append(math);
    span.addEventListener("mousedown", (e) => {
      // into the source, just inside the opener
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.at } });
      view.focus();
    });
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function mathDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const { from: selFrom, to: selTo } = state.selection.main;
  const out: Range<Decoration>[] = [];
  for (const f of findFormulas(text)) {
    // the caret (or a selection) touching it: show the source
    if (selFrom <= f.to && selTo >= f.from) continue;
    // (an environment's body as MathJax takes it: align* → aligned…)
    const latex = prepareLatex({ latex: f.latex, caret: 0, env: f.env }, "").plain;
    if (!mathParses(latex, f.display)) continue; // doesn't parse (yet): leave the source
    const opener = /^(?:\$\$|\$|\\[([]|\\begin\s*\{[^}]*\})/.exec(text.slice(f.from, f.from + 40))?.[0].length ?? 1;
    const widget = new MathWidget(latex, f.display, f.from + opener);
    out.push(Decoration.replace({ widget }).range(f.from, f.to));
  }
  return Decoration.set(out);
}

const mathField = StateField.define<DecorationSet>({
  create: mathDecorations,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? mathDecorations(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { color: "inherit", backgroundColor: "transparent", font: "inherit", maxHeight: "min(50vh, 420px)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "auto" },
  ".cm-content": { padding: "0", caretColor: "currentColor", minHeight: "1.5em" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "inherit", opacity: "0.5" },
  // drawn by drawSelection (Vim's visual modes need it): a tint that reads on light and dark pages
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "rgba(66, 133, 244, .32)",
  },
  ".cm-cursor": { borderLeftColor: "currentColor" },
  // Vim's block cursor in normal mode
  ".cm-fat-cursor": { background: "rgba(66, 133, 244, .55) !important", outline: "none" },
  "&:not(.cm-focused) .cm-fat-cursor": { background: "none !important", outline: "1px solid rgba(66, 133, 244, .55)" },
  ".wl-math": { cursor: "text", padding: "0 1px", borderRadius: "3px" },
  ".wl-math:hover": { backgroundColor: "rgba(127,127,127,.12)" },
  ".wl-display": { display: "inline-block", width: "100%", textAlign: "center", margin: "4px 0" },
});

export interface ComposerEditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholder: string;
  /** send the message (returns false to type a line break instead) */
  onSend: () => boolean;
  onChange: (text: string) => void;
  /** Vim keys (normal, insert, visual modes) */
  vim?: boolean;
  /** only ⌘Enter / Ctrl+Enter sends; Enter starts a new line */
  modEnter?: boolean;
}

export function createEditor(o: ComposerEditorOptions): EditorView {
  // (an IME's Enter confirms the composition, it doesn't send)
  const send = (v: EditorView) => (v.composing ? false : o.onSend());
  const extensions: Extension[] = [
    // Vim first: in normal mode its keys (Enter too) come before ours
    o.vim ? vim() : [],
    history(),
    // the selection drawn as a layer (Vim's visual modes draw theirs here)
    drawSelection(),
    keymap.of([
      ...(o.modEnter
        ? [{ key: "Mod-Enter", run: send }, { key: "Enter", run: insertNewline }]
        : [{ key: "Enter", run: send }, { key: "Mod-Enter", run: send }]),
      { key: "Shift-Enter", run: insertNewline },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    placeholder(o.placeholder),
    mathField,
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) o.onChange(u.state.doc.toString());
    }),
  ];
  return new EditorView({ parent: o.parent, state: EditorState.create({ doc: o.doc, extensions }) });
}

/** In Vim's normal or visual mode (keys are commands, not text)? */
export function vimCommandMode(view: EditorView): boolean {
  const state = getCM(view)?.state.vim as { insertMode?: boolean } | undefined;
  return !!state && !state.insertMode;
}

/**
 * Esc and Enter, taken before the site's own key listeners (content/isolated.ts):
 * some sites catch them on the window first (Claude sends on Enter, eats Esc).
 * Returns whether the key was handled here.
 */
export function handleTakenKey(view: EditorView, e: KeyboardEvent, o: { vim?: boolean }): boolean {
  if (e.isComposing || e.keyCode === 229 || view.composing) return false; // an IME's own Enter / Esc
  const cm = o.vim ? getCM(view) : null;
  if (e.key === "Escape") {
    if (!cm) return false; // the site's (closing a menu, stopping a reply)
    Vim.handleKey(cm, "<Esc>", "user");
    return true;
  }
  if (e.key !== "Enter") return false;
  if (cm && vimCommandMode(view) && !e.metaKey && !e.ctrlKey) {
    Vim.handleKey(cm, e.shiftKey ? "<S-CR>" : "<CR>", "user");
    return true;
  }
  // our keymap: send, or a new line
  return runScopeHandlers(view, e, "editor");
}

/** Replace the whole text (from the site), the caret at the end. */
export function setText(view: EditorView, text: string) {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
}
