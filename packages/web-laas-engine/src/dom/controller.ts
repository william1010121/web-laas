import { adapterFor, deepActiveElement, type AdapterFactory, type EditorAdapter } from "./adapters";
import {
  compileConfig,
  hostMatches,
  snippetsForHost,
  resolveMathDelimiters,
  withMathDelimiters,
  type CompiledConfig,
  type MathDelimiters,
  type Snippet,
} from "../core/config";
import { findExpansion, type Expansion } from "../core/matcher";
import type { Range } from "../core/template";
import { mathContext } from "../core/tex";
import { cdlatexBackTab, cdlatexTab } from "../core/cdlatex";
import { findFormulas, formulaAt, type Formula } from "../core/formula";
import type { CaretRect } from "./adapters/types";

/** The formula under the caret, for a live preview. */
export interface FormulaState extends Formula {
  /** the caret on screen (viewport coordinates), when the editor can tell */
  rect: CaretRect | null;
  /** which formula this is: the editor plus where the formula starts (stable while you type in it) */
  id: string;
}

/** Behaviour switches (the snippet list itself lives in the config text). */
export interface LaasPrefs {
  /** Tab / Shift+Tab move between tabstops */
  tabJump: boolean;
  /**
   * Tab moves like Emacs cdlatex-tab: out of a group, into the next empty {},
   * past $ — inside a snippet field only up to the field's end
   */
  tabOut: boolean;
  /** when Tab leaves a one-character script, x_{2} → x_2 (cdlatex) */
  simplifyScripts: boolean;
  /** Backspace right after an expansion restores what was typed */
  backspaceUndo: boolean;
  /** laas auto space: add a space after \alpha-like expansions */
  autoSpace: boolean;
  /** include the web extras snippet set (mk, dm, sum, lim, …) */
  extras: boolean;
  /** include cdlatex: ` symbols, ' modifiers, _ ^ braces, Tab commands */
  cdlatex: boolean;
  /** cdlatex pairs: $ → $|$ in text, [ { → [|] {|} in math (everywhere on Overleaf) */
  autoPair: boolean;
  /**
   * Tab never leaves the editor: in text it types `tabSpaces` spaces, and
   * Shift+Tab goes back into the previous formula
   */
  tabEverywhere: boolean;
  /** spaces a Tab types in text, with `tabEverywhere` */
  tabSpaces: number;
}

export const DEFAULT_PREFS: LaasPrefs = {
  tabJump: true,
  tabOut: true,
  simplifyScripts: true,
  backspaceUndo: true,
  autoSpace: true,
  extras: true,
  cdlatex: true,
  autoPair: true,
  tabEverywhere: false,
  tabSpaces: 4,
};

export interface RuntimeState {
  /** user config text; null = built-in defaults only */
  configText: string | null;
  enabled: boolean;
  /** extra hosts to disable on top of the config's disabledSites */
  disabledHosts: string[];
  prefs: Partial<LaasPrefs>;
  /** per-site mk / dm delimiters, keyed by host pattern ("overleaf.com" covers its subdomains) */
  siteMath?: Record<string, MathDelimiters>;
  /** more snippets of your own, after the config's (see CompileOptions.snippets) */
  snippets?: unknown[];
}

export interface ControllerOptions {
  /** window to listen on (default: globalThis.window) */
  window?: Window;
  /** host used for sites / disabledSites matching (default: window.location.hostname) */
  host?: string;
  /** only handle focused elements for which this returns true */
  filter?: (el: Element) => boolean;
  /**
   * Are keys in this (filtered-in) element text right now? When false they
   * expand nothing and Tab is left alone, but the formula under the caret is
   * still reported (e.g. Vim's normal mode, where keys are commands)
   */
  typing?: (el: Element) => boolean;
  /** custom editors, tried before the built-in adapters */
  adapters?: AdapterFactory[];
  /** called when the config text fails to compile (defaults are used instead) */
  onConfigError?: (error: Error) => void;
  /**
   * Live preview hook: called with the formula under the caret whenever it
   * (or the caret's position on screen) changes, and with null when the caret
   * leaves math or the editor.
   */
  onFormula?: (formula: FormulaState | null) => void;
}

/**
 * An expanded snippet whose fields are still active (like a yasnippet
 * snippet). Snippets expanded inside a field stack on top of it.
 */
interface Session {
  id: object;
  /** absolute ranges in visit order; the last one is the exit ($0) */
  stops: Range[];
  /** the active field (never the exit) */
  idx: number;
}

interface LastExpansion {
  id: object;
  from: number;
  inserted: string;
  original: string;
  caret: number;
  len: number;
  session: Session | null;
}

/** How much text before the caret is scanned for math-mode detection. */
const CONTEXT_CHARS = 20000;
const MODIFIER_KEYS = new Set(["Shift", "Alt", "Control", "Meta", "CapsLock", "Fn"]);
/**
 * Editors whose model is already updated when the `input` event bubbles to the
 * window, so we can expand right away. Others (ProseMirror, CodeMirror 6) read
 * DOM mutations asynchronously; for them we wait for a timer.
 */
const SYNC_INPUT_KINDS = new Set(["textarea", "cm5"]);
/** cdlatex-paired-parens "$[{" */
const PAIRS: Record<string, string> = { $: "$", "[": "]", "{": "}" };
const TYPE_OVER: Record<string, true> = { "]": true, "}": true };
/** openers an editor may auto-close by itself */
const EDITOR_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "'": "'", '"': '"', "`": "`", $: "$" };
/** closers that cdlatex's lr( lr[ lr{ … eat when they follow the keyword */
const LR_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">", "|": "|" };

export class LaasController {
  private config: CompiledConfig;
  private snippets: Snippet[];
  private state: RuntimeState = { configText: null, enabled: true, disabledHosts: [], prefs: {} };
  private prefs: LaasPrefs = { ...DEFAULT_PREFS };
  private sessions: Session[] = [];
  /** document length and selection when the tabstops were last known to be exact */
  private base: { id: object; len: number; from: number; to: number } | null = null;
  private last: LastExpansion | null = null;
  private composing = false;
  /**
   * A closer the editor itself inserted after an opener we just saw typed
   * (CodeMirror's closeBrackets: ' → '|', [ → [|]). An expansion whose
   * trigger contains that opener replaces the closer too.
   */
  private autoCloser: { id: object; at: number; ch: string } | null = null;
  /** a typed character waiting to be checked for triggers */
  private pending: { key: string; adapter: EditorAdapter; lenBefore?: number } | null = null;
  private readonly win: Window;
  private readonly host: string;
  private readonly filter: (el: Element) => boolean;
  private readonly typing: (el: Element) => boolean;
  private readonly factories: AdapterFactory[];
  private readonly onConfigError: (error: Error) => void;
  private readonly onFormula?: (formula: FormulaState | null) => void;
  private formulaQueued = false;
  /** listening: queued formula work from before a detach must not report */
  private attached = false;
  /** formula reports wanted (a hidden preview needs none, so no scanning either) */
  private watching = true;
  private lastFormula = "null";
  private editorIds = new WeakMap<object, number>();
  private nextEditorId = 1;
  private readonly formulaSoon = () => this.scheduleFormula();
  private readonly formulaGone = () => this.win.setTimeout(() => this.scheduleFormula(), 0);
  private readonly keydown = (e: KeyboardEvent) => this.onKeyDown(e);
  private readonly compStart = () => (this.composing = true);
  /**
   * Input methods (Zhuyin, Pinyin, Japanese, dead keys…) often deliver
   * punctuation like ` ' [ through a composition instead of a plain key:
   * keydown says 229 / "Process". Check what they committed, like a typed key.
   */
  private readonly compEnd = (e: CompositionEvent) => {
    this.composing = false;
    this.typedWithoutKey(e.data);
  };
  private readonly input = (e: Event) => {
    if (this.busy) return; // our own edits
    const sawKey = this.keySeen;
    this.keySeen = false;
    if (this.pending) {
      if (SYNC_INPUT_KINDS.has(this.pending.adapter.kind)) this.runPending(false);
      return;
    }
    const ie = e as InputEvent;
    // text inserted without a usable keydown (IME commit, no keydown at all)
    if (!this.composing && ie.inputType === "insertText" && (this.imeKey || !sawKey)) this.typedWithoutKey(ie.data);
    this.scheduleFormula(); // pastes, drops, undo…
  };
  /** the last keydown was an IME key (229): its text arrives via input/compositionend */
  private imeKey = false;
  /** a keydown happened since the last input event */
  private keySeen = false;
  /** true while we edit the document ourselves */
  private busy = false;
  /** document length after the last input we handled (for inputs without a keydown) */
  private seenLen: { id: object; len: number } | null = null;

  private typedWithoutKey(data: string | null | undefined) {
    this.imeKey = false;
    if (!this.active || !data || this.pending) return;
    const ch = data[data.length - 1];
    if (!/[\x21-\x7e]/.test(ch)) return; // only ASCII can end a trigger
    const focused = deepActiveElement(this.win.document);
    if (!focused || !this.filter(focused) || !this.typing(focused)) return;
    const adapter = adapterFor(focused, this.factories);
    if (!adapter) return;
    this.last = null;
    // no keydown to measure before the insertion: use the length we saw last
    const watch = ch in PAIRS || ch in TYPE_OVER || ch in EDITOR_PAIRS;
    const lenBefore = watch && this.seenLen?.id === adapter.id ? this.seenLen.len : undefined;
    this.pending = { key: ch, adapter, lenBefore };
    this.win.setTimeout(() => this.runPending(true), 0);
  }

  constructor(options: ControllerOptions = {}) {
    this.win = options.window ?? window;
    this.host = options.host ?? this.win.location.hostname;
    this.filter = options.filter ?? (() => true);
    this.typing = options.typing ?? (() => true);
    this.factories = options.adapters ?? [];
    this.onFormula = options.onFormula;
    this.onConfigError =
      options.onConfigError ?? ((e) => console.warn("[web-laas] config error, using defaults:", e.message));
    this.config = compileConfig(null).config;
    this.snippets = snippetsForHost(this.config, this.host);
  }

  setState(state: Partial<RuntimeState>) {
    this.state = { ...this.state, ...state };
    this.prefs = { ...DEFAULT_PREFS, ...this.state.prefs };
    const opts = { extras: this.prefs.extras, cdlatex: this.prefs.cdlatex, snippets: this.state.snippets };
    try {
      this.config = compileConfig(this.state.configText, opts).config;
    } catch (e) {
      this.onConfigError(e as Error);
      this.config = compileConfig(null, opts).config;
    }
    this.snippets = withMathDelimiters(
      snippetsForHost(this.config, this.host),
      resolveMathDelimiters(this.state.siteMath, this.host),
      this.host,
    );
    this.sessions = [];
    this.last = null;
    this.scheduleFormula(); // turning web-laas off hides the preview
  }

  get active(): boolean {
    if (!this.state.enabled) return false;
    const blocked = [...this.config.disabledSites, ...this.state.disabledHosts];
    return !blocked.some((p) => hostMatches(this.host, p));
  }

  /** Start listening for keystrokes. Returns `detach`. */
  attach(): () => void {
    const w = this.win;
    this.attached = true;
    w.addEventListener("keydown", this.keydown, true);
    w.addEventListener("compositionstart", this.compStart, true);
    w.addEventListener("compositionend", this.compEnd, true);
    w.addEventListener("input", this.input);
    if (this.onFormula) {
      for (const t of ["keyup", "mouseup", "focusin", "resize"]) w.addEventListener(t, this.formulaSoon, true);
      w.addEventListener("scroll", this.formulaSoon, { capture: true, passive: true });
      w.addEventListener("focusout", this.formulaGone, true);
      // caret moves with no key or mouse: selection handles, setSelectionRange, editor transactions
      w.document.addEventListener("selectionchange", this.formulaSoon);
    }
    return () => this.detach();
  }

  detach() {
    const w = this.win;
    this.attached = false;
    w.removeEventListener("keydown", this.keydown, true);
    w.removeEventListener("compositionstart", this.compStart, true);
    w.removeEventListener("compositionend", this.compEnd, true);
    w.removeEventListener("input", this.input);
    for (const t of ["keyup", "mouseup", "focusin", "resize", "scroll"]) w.removeEventListener(t, this.formulaSoon, true);
    w.removeEventListener("focusout", this.formulaGone, true);
    w.document.removeEventListener("selectionchange", this.formulaSoon);
    if (this.onFormula && this.lastFormula !== "null") this.onFormula(null);
    this.lastFormula = "null";
    this.pending = null;
    this.sessions = [];
    this.last = null;
  }

  /** Pause or resume formula reports; while paused nothing is scanned (turning off reports null once). */
  watchFormula(on: boolean) {
    if (on === this.watching) return;
    this.watching = on;
    if (on) return this.refreshFormula();
    if (this.onFormula && this.lastFormula !== "null") this.onFormula(null);
    this.lastFormula = "null";
  }

  /** Report the formula under the caret again (e.g. when a preview just appeared). */
  refreshFormula() {
    this.lastFormula = "";
    this.scheduleFormula();
  }

  private scheduleFormula() {
    if (!this.onFormula || !this.attached || !this.watching || this.formulaQueued) return;
    this.formulaQueued = true;
    this.win.requestAnimationFrame(() => {
      this.formulaQueued = false;
      if (!this.attached || !this.watching) return;
      const f = this.currentFormula();
      const key = JSON.stringify(f);
      if (key === this.lastFormula) return;
      this.lastFormula = key;
      this.onFormula!(f);
    });
  }

  private currentFormula(): FormulaState | null {
    if (!this.active) return null;
    const focused = deepActiveElement(this.win.document);
    if (!focused || !this.filter(focused)) return null;
    const adapter = adapterFor(focused, this.factories);
    const sel = adapter?.getSelection();
    if (!adapter || !sel) return null;
    // back far enough to see the opener: a blank line before the caret is a safe place to start
    let want = CONTEXT_CHARS;
    let before = adapter.textBefore(sel.to, want);
    while (before.length === want && want < 128000 && !/\n[ \t]*\n/.test(before)) {
      want += 20000;
      before = adapter.textBefore(sel.to, want);
    }
    // read on in chunks until a blank line (no formula runs past one) or the end; bounded for huge documents
    const len = adapter.getLength();
    let end = Math.min(len, sel.to + 4000);
    let after = adapter.slice(sel.to, end);
    while (end < len && after.length < 64000 && !/\n[ \t]*\n/.test(after)) {
      end = Math.min(len, end + 16000);
      after = adapter.slice(sel.to, end);
    }
    const f = formulaAt(before, after, { comments: this.latexComments() });
    if (!f) return null;
    let rect: CaretRect | null = null;
    try {
      rect = adapter.caretRect?.() ?? null;
    } catch {
      rect = null;
    }
    let editor = this.editorIds.get(adapter.id);
    if (editor === undefined) this.editorIds.set(adapter.id, (editor = this.nextEditorId++));
    return { ...f, rect, id: `${editor}:${sel.to - f.caret}` };
  }

  /** The compiled config currently in use. */
  get compiled(): CompiledConfig {
    return this.config;
  }

  private latexComments() {
    return this.config.latexCommentSites.some((p) => hostMatches(this.host, p));
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.active) return;
    // The previous character is in the editor by now: check it before this
    // key, so fast typing (e.g. a trigger followed at once by Tab) never
    // outruns the timer.
    if (this.pending) this.runPending(true);
    this.keySeen = true;
    this.imeKey = e.keyCode === 229 || e.key === "Process" || e.key === "Dead";
    if (e.isComposing || this.imeKey) return;
    const focused = deepActiveElement(this.win.document);
    if (!focused || !this.filter(focused) || !this.typing(focused)) return;
    const adapter = adapterFor(focused, this.factories);
    if (!adapter) return;

    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Keep tabstops in step with every edit, and end snippets the caret left.
    if (this.sessionsFor(adapter).length) this.sync(adapter);

    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Leave Tab to the editor's own completion popup (Overleaf, Jupyter…).
      if (adapter.completionActive?.()) return;
      this.last = null;
      this.busy = true;
      try {
        if (this.onTab(adapter, e.shiftKey)) {
          consume();
          if (!e.shiftKey) this.trimExit(adapter);
        }
      } finally {
        this.busy = false;
      }
      this.scheduleFormula();
      return;
    }
    if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.busy = true;
      const reverted = this.revert(adapter);
      this.busy = false;
      if (reverted) return consume();
      this.last = null;
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.last = null;
      // Let the editor insert the character first, then look for a trigger:
      // on the `input` event when the editor is synchronous, else on a timer.
      const watch = e.key in PAIRS || e.key in TYPE_OVER || e.key in EDITOR_PAIRS;
      // remember the length so we can tell whether the editor auto-paired itself
      this.pending = { key: e.key, adapter, lenBefore: watch ? adapter.getLength() : undefined };
      this.win.setTimeout(() => this.runPending(true), 0);
      return;
    }
    if (!MODIFIER_KEYS.has(e.key)) this.last = null;
  }

  /** Check the pending typed character; keep it if the editor hasn't inserted it yet (unless final). */
  private runPending(final: boolean) {
    const p = this.pending;
    if (!p) return;
    if (this.composing) {
      this.pending = null;
      return;
    }
    this.busy = true;
    try {
      this.checkPending(p, final);
    } finally {
      this.busy = false;
    }
    this.scheduleFormula();
  }

  private checkPending(p: NonNullable<LaasController["pending"]>, final: boolean) {
    if (p.lenBefore !== undefined) this.noteEditorPair(p.adapter, p.key, p.lenBefore);
    const r = this.expandAtCaret(p.adapter, true, p.key);
    const pairs = this.prefs.cdlatex && this.prefs.autoPair && (p.key in PAIRS || p.key in TYPE_OVER);
    if (r === false && pairs && p.lenBefore !== undefined) this.autoPair(p.adapter, p.key, p.lenBefore);
    if (r === false && p.key === "$") this.trimExit(p.adapter);
    if (r !== null || final) {
      this.pending = null;
      this.seenLen = { id: p.adapter.id, len: p.adapter.getLength() };
    }
  }

  /** Remember a closer the editor auto-inserted for the opener just typed. */
  private noteEditorPair(adapter: EditorAdapter, key: string, lenBefore: number) {
    const close = EDITOR_PAIRS[key];
    if (!close) return;
    const sel = adapter.getSelection();
    if (!sel || sel.from !== sel.to || adapter.getLength() - lenBefore !== 2) return;
    if (adapter.slice(sel.to, sel.to + 1) === close) this.autoCloser = { id: adapter.id, at: sel.to, ch: close };
  }

  /** cdlatex-dollar / cdlatex-pbb, after the editor inserted `key`. */
  private autoPair(adapter: EditorAdapter, key: string, lenBefore: number) {
    const sel = adapter.getSelection();
    if (!sel || sel.from !== sel.to) return;
    const caret = sel.to;
    const len = adapter.getLength();
    if (len - lenBefore !== 1) return; // the editor paired it itself (or did something else)
    const before = adapter.textBefore(caret, CONTEXT_CHARS);
    if (!before.endsWith(key)) return;
    let slashes = 0;
    for (let i = before.length - 2; i >= 0 && before[i] === "\\"; i--) slashes++;
    if (slashes % 2) return; // \$ \{ are literal
    const inMath = mathContext(before.slice(0, -1), { comments: this.latexComments() }).math;
    const next = adapter.slice(caret, caret + 1);
    if (this.sessionsFor(adapter).length) this.sync(adapter);
    if (key in TYPE_OVER) {
      // typing a closer right before the same closer steps over it
      if (inMath && next === key) {
        adapter.replace(caret, caret + 1, "", caret, caret);
        this.shiftStops(caret, -1);
        this.rebase(adapter);
      }
      return;
    }
    if (key === "$") {
      if (inMath) {
        // closing an inline formula: step over the $ we inserted earlier
        if (next === "$") {
          adapter.replace(caret, caret + 1, "", caret, caret);
          this.shiftStops(caret, -1);
          this.rebase(adapter);
        }
        return;
      }
    } else if (!inMath && !this.latexComments()) {
      return; // [ { outside math: only in LaTeX documents (Overleaf)
    }
    adapter.replace(caret, caret, PAIRS[key], caret, caret);
    this.shiftStops(caret, 1);
    // the caret stays before the closer, inside the active field
    this.rebase(adapter);
  }

  /**
   * Right after leaving a formula ($\alpha |$ → $\alpha$|): drop the spaces
   * before its closer. They do nothing in TeX, and laas's auto space after
   * \alpha always leaves one there.
   */
  private trimExit(adapter: EditorAdapter) {
    const sel = adapter.getSelection();
    if (!sel || sel.from !== sel.to) return;
    const before = adapter.textBefore(sel.to, CONTEXT_CHARS);
    const m = /([ \t]+)\n?(\$\$|\$|\\\)|\\\])$/.exec(before);
    if (!m) return;
    const spaces = m.index;
    if (before[spaces - 1] === "\\") return; // "\ " is a space TeX keeps
    const ctx = mathContext(before.slice(0, before.length - m[2].length), { comments: this.latexComments() });
    // the closer ends a formula with something in it ($ $ stays as it is)
    if (!ctx.math || ctx.start === undefined || !before.slice(ctx.start, spaces).trim()) return;
    // Markdown sites read a single $ the Pandoc way: "$5 and $" is a price, "$HOME or $" plain text.
    // There only trim one word ($x $) or something that is clearly LaTeX ($\alpha $, $a^2 + b $).
    const inner = before.slice(ctx.start, spaces);
    if (m[2] === "$" && !this.latexComments() && (/^[\s\d]/.test(inner) || (/\s/.test(inner) && !/[\\^_{}]/.test(inner)))) return;
    const base = sel.to - before.length;
    const len = m[1].length;
    if (this.sessionsFor(adapter).length) this.sync(adapter);
    adapter.replace(base + spaces, base + spaces + len, "", sel.to - len, sel.to - len);
    this.shiftStops(base + spaces, -len);
    this.rebase(adapter);
  }

  /**
   * Try to expand a snippet ending at the caret. Returns null when `typed`
   * is not (yet) the character before the caret.
   */
  private expandAtCaret(adapter: EditorAdapter, auto: boolean, typed: string | null): boolean | null {
    const sel = adapter.getSelection();
    if (!sel || sel.from !== sel.to) return false;
    const caret = sel.to;
    const before = adapter.textBefore(caret, CONTEXT_CHARS);
    if (typed !== null && !before.endsWith(typed)) return null;
    const exp = findExpansion(this.snippets, before, { auto, latexComments: this.latexComments() });
    if (!exp) return false;
    this.apply(adapter, exp, caret - before.length, caret);
    return true;
  }

  private apply(adapter: EditorAdapter, exp: Expansion, base: number, caret: number) {
    if (this.sessionsFor(adapter).length) this.sync(adapter); // count the trigger's own keystrokes
    const from = base + exp.from;
    // cdlatex-lr-pair: lr( with an auto-paired ) after it replaces both
    const lr = /^lr([([{<|])$/.exec(exp.snippet.trigger ?? "");
    const ac = this.autoCloser;
    if (lr && adapter.slice(caret, caret + 1) === LR_CLOSE[lr[1]]) caret += 1;
    else if (ac && ac.id === adapter.id && from < ac.at && ac.at <= caret && adapter.slice(caret, caret + 1) === ac.ch) {
      // the opener was part of this trigger: its auto-inserted closer goes too
      caret += 1;
    }
    this.autoCloser = null;
    let { text, stops } = exp.rendered;
    if (exp.autoSpace && this.prefs.autoSpace && !/[)\]]/.test(adapter.slice(caret, caret + 1))) {
      text += " ";
      stops = [{ start: text.length, end: text.length }];
    }
    const abs = stops.map((r) => ({ start: from + r.start, end: from + r.end }));
    const first = abs[0];
    adapter.replace(from, caret, text, first.start, first.end);
    this.shiftStops(from, -(caret - from));
    this.shiftStops(from, text.length);

    const len = adapter.getLength();
    let session: Session | null = null;
    if (abs.length > 1) {
      // nested inside the active field of an outer snippet, if any (yasnippet stacking)
      session = { id: adapter.id, stops: abs, idx: 0 };
      this.sessions.push(session);
    }
    this.rebase(adapter);
    this.last =
      first.start === first.end
        ? { id: adapter.id, from, inserted: text, original: exp.original, caret: first.end, len, session }
        : null;
  }

  /** Backspace right after an expansion restores what was typed. */
  private revert(adapter: EditorAdapter): boolean {
    const l = this.last;
    this.last = null;
    if (!l || !this.prefs.backspaceUndo || l.id !== adapter.id) return false;
    const sel = adapter.getSelection();
    if (!sel || sel.from !== sel.to || sel.to !== l.caret) return false;
    if (adapter.getLength() !== l.len) return false;
    const end = l.from + l.inserted.length;
    if (adapter.slice(l.from, end) !== l.inserted) return false;
    const caret = l.from + l.original.length;
    if (l.session) this.sessions = this.sessions.filter((s) => s !== l.session);
    adapter.replace(l.from, end, l.original, caret, caret);
    this.shiftStops(l.from, -l.inserted.length);
    this.shiftStops(l.from, l.original.length);
    this.rebase(adapter);
    return true;
  }

  // ── Tab ─────────────────────────────────────────────────────────────────
  // Mirrors Emacs with yasnippet + cdlatex (cdlatex-tab with the
  // cdlatex-in-yas-field hook):
  //   1. expand a Tab-triggered snippet before the caret
  //   2. in a snippet field, before its end: move like cdlatex-tab, but no
  //      further than the end of the field
  //   3. at the end of the field: next field; after the last field, go to the
  //      snippet's exit ($0) and hand over to the snippet around it
  //   4. outside snippets, in math: move like cdlatex-tab
  // Shift+Tab mirrors it: back within the field (cdlatexBackTab, not before
  // the field's start), then the previous field; it never leaves the first
  // field. In math, Tab and Shift+Tab are always handled (focus never leaves
  // the editor); in text they go to the page unless next to a formula.

  private onTab(adapter: EditorAdapter, back: boolean): boolean {
    if (!back && this.expandAtCaret(adapter, false, null)) return true;
    const sel = adapter.getSelection();
    if (!sel) return false;
    const top = this.prefs.tabJump ? this.sessionsFor(adapter).at(-1) : undefined;
    if (top) {
      const field = top.stops[top.idx];
      if (back) {
        // mirror of Tab: inside the field step back (no further than its
        // start), at its start go to the previous field, and stay put in the
        // first one — never jump out of the math
        if (this.prefs.tabOut && sel.from > field.start) {
          const before = adapter.textBefore(sel.from, CONTEXT_CHARS);
          const base = sel.from - before.length;
          const text = before + adapter.slice(sel.from, sel.from + 2000);
          const to = cdlatexBackTab(text, before.length, Math.max(0, field.start - base));
          this.setCaret(adapter, Math.max(field.start, base + to));
        } else if (top.idx > 0) this.moveToField(adapter, top, top.idx - 1);
        return true;
      }
      if (this.prefs.tabOut && sel.to < field.end && this.cdlatexMove(adapter, sel.to, field)) return true;
      if (top.idx + 1 < top.stops.length - 1) this.moveToField(adapter, top, top.idx + 1);
      else this.exitSnippet(adapter, top);
      return true;
    }
    if (!this.prefs.tabOut) return this.tabInText(adapter, back);
    const caret = back ? sel.from : sel.to;
    const before = adapter.textBefore(caret, CONTEXT_CHARS);
    const base = caret - before.length;
    const comments = this.latexComments();
    const ctx = mathContext(before, { comments });
    // In math, Tab and Shift+Tab never move focus out of the editor.
    if (ctx.math) {
      if (!back) {
        this.cdlatexMove(adapter, caret, null);
        return true;
      }
      const start = ctx.start ?? 0;
      // simulate Tab over the real text, not a window that ends at the caret
      const text = before + adapter.slice(caret, caret + 2000);
      const target =
        before.length <= start
          ? start - (ctx.openLen ?? 0) // at the start of the formula: step out before its opener
          : cdlatexBackTab(text, before.length, Math.max(start, before.length - 3000));
      this.setCaret(adapter, base + target);
      return true;
    }
    if (back) {
      // just after a formula ($x$|, \)|): step back inside it
      const m = /(?:\$\$|\$|\\\)|\\\])$/.exec(before);
      if (m && mathContext(before.slice(0, m.index), { comments }).math) {
        this.setCaret(adapter, base + m.index);
        return true;
      }
      return this.tabInText(adapter, back);
    }
    // just before a formula (|$x$): step inside it, like cdlatex-tab does
    const after = adapter.slice(caret, caret + 2);
    const open = /^(?:\$\$|\$|\\\(|\\\[)/.exec(after);
    if (open) {
      this.setCaret(adapter, caret + open[0].length);
      return true;
    }
    return this.tabInText(adapter, back);
  }

  /**
   * Tab in text, away from formulas: left to the page, unless it's kept in the
   * editor (tabEverywhere). Then Tab types spaces, and Shift+Tab goes back
   * into the previous formula, just before its closer.
   */
  private tabInText(adapter: EditorAdapter, back: boolean): boolean {
    if (!this.prefs.tabEverywhere) return false;
    const sel = adapter.getSelection();
    if (!sel) return true;
    if (!back) {
      const spaces = " ".repeat(Math.max(1, Math.min(16, Math.round(this.prefs.tabSpaces) || 4)));
      if (this.sessionsFor(adapter).length) this.sync(adapter);
      const at = sel.from + spaces.length;
      adapter.replace(sel.from, sel.to, spaces, at, at);
      this.shiftStops(sel.from, -(sel.to - sel.from));
      this.shiftStops(sel.from, spaces.length);
      this.rebase(adapter);
      return true;
    }
    const before = adapter.textBefore(sel.from, CONTEXT_CHARS);
    const last = findFormulas(before, { comments: this.latexComments() }).at(-1);
    if (last) {
      const closer = /(?:\$\$|\$|\\\)|\\\]|\\end\s*\{[^{}]*\})$/.exec(before.slice(last.from, last.to));
      this.setCaret(adapter, sel.from - before.length + last.to - (closer?.[0].length ?? 0));
    }
    return true;
  }

  private setCaret(adapter: EditorAdapter, pos: number) {
    adapter.setSelection(pos, pos);
    this.rebase(adapter);
  }

  private moveToField(adapter: EditorAdapter, s: Session, idx: number) {
    s.idx = idx;
    const f = s.stops[idx];
    adapter.setSelection(f.start, f.end);
    this.rebase(adapter);
  }

  private exitSnippet(adapter: EditorAdapter, s: Session) {
    const exit = s.stops[s.stops.length - 1];
    this.sessions = this.sessions.filter((x) => x !== s);
    adapter.setSelection(exit.start, exit.start);
    this.rebase(adapter);
  }

  /** cdlatex-tab movement from `caret`; inside a field, stop at its end. */
  private cdlatexMove(adapter: EditorAdapter, caret: number, field: Range | null): boolean {
    const from = Math.max(0, caret - 3); // simplification looks 3 chars back
    const len = adapter.getLength();
    const text = adapter.slice(from, Math.min(len, caret + 2000));
    let m = cdlatexTab(text, caret - from, { simplify: this.prefs.simplifyScripts });
    // only simplify a script that lies within the field
    if (m.edit && field && (from + m.edit.from < field.start || from + m.edit.to > field.end)) {
      m = cdlatexTab(text, caret - from, { simplify: false });
    }
    let to = from + m.to;
    let limit = field?.end ?? Infinity;
    if (m.edit) {
      const ef = from + m.edit.from;
      const removed = m.edit.to - m.edit.from;
      const target = Math.min(to, limit - removed + m.edit.insert.length);
      adapter.replace(ef, from + m.edit.to, m.edit.insert, target, target);
      this.shiftStops(ef, -removed);
      this.shiftStops(ef, m.edit.insert.length);
      limit = field ? field.end : limit; // shiftStops updated the field
      to = Math.min(to, limit);
      adapter.setSelection(to, to);
    } else {
      to = Math.min(to, limit);
      if (to === caret && field) to = field.end;
      if (to === caret) return false;
      adapter.setSelection(to, to);
    }
    this.rebase(adapter);
    return true;
  }

  // ── tabstop bookkeeping ───────────────────────────────────────────────────

  private sessionsFor(adapter: EditorAdapter): Session[] {
    if (this.sessions.some((s) => s.id !== adapter.id)) this.sessions = this.sessions.filter((s) => s.id === adapter.id);
    return this.sessions;
  }

  private rebase(adapter: EditorAdapter) {
    const sel = adapter.getSelection();
    this.base = sel ? { id: adapter.id, len: adapter.getLength(), from: sel.from, to: sel.to } : null;
  }

  /**
   * Bring every tabstop up to date with what was typed since the last call
   * (like yasnippet's overlays), then end the snippets whose active field the
   * caret has left.
   */
  private sync(adapter: EditorAdapter) {
    const sel = adapter.getSelection();
    const len = adapter.getLength();
    const b = this.base;
    if (sel && b && b.id === adapter.id && len !== b.len) {
      this.shiftStops(Math.min(b.from, sel.from), len - b.len);
    }
    this.base = sel ? { id: adapter.id, len, from: sel.from, to: sel.to } : null;
    for (let top = this.sessions.at(-1); top; top = this.sessions.at(-1)) {
      const f = top.stops[top.idx];
      if (sel && f.start <= sel.from && sel.to <= f.end) break;
      this.sessions.pop(); // left the field: the snippet is done (yasnippet "commit")
    }
  }

  /**
   * Adjust tabstops for an edit at `at`: `delta` > 0 characters inserted,
   * < 0 deleted. Insertions grow the active field and the fields that
   * contain it (outer snippets), and push later fields to the right.
   */
  private shiftStops(at: number, delta: number) {
    if (!delta || !this.sessions.length) return;
    const top = this.sessions[this.sessions.length - 1];
    const act = top.stops[top.idx];
    const ranges = this.sessions.flatMap((s) => s.stops);
    if (delta > 0) {
      const holds = ranges.map((r) => r.start <= act.start && act.end <= r.end);
      ranges.forEach((r, i) => {
        if (holds[i] && r.start <= at && at <= r.end) r.end += delta;
        else if (r.start >= at) {
          r.start += delta;
          r.end += delta;
        } else if (r.end > at) r.end += delta;
      });
    } else {
      const n = -delta;
      const map = (p: number) => (p >= at + n ? p - n : p > at ? at : p);
      for (const r of ranges) {
        r.start = map(r.start);
        r.end = map(r.end);
      }
    }
  }
}
