// Formulas typeset in place in CodeMirror 5 Markdown editors (HackMD): the
// editor's own markText replaces each formula the caret isn't in, so the text
// really collapses to the formula's width, as in Obsidian or Typora. Move the
// caret onto it, or click it, and the source is back.
//
// This runs in the page's main world, where the editor is. The SVG comes from
// preview.js (isolated world, where MathJax is): we leave an empty
// <span data-web-laas-math> in the mark, it fills it in and tells us, and the
// editor measures the line again.
import { findFormulas } from "web-laas-engine";

/** preview.js: fill the empty math spans */
export const CM5_FILL_EVENT = "web-laas:cm5-fill";
/** preview.js, on a span it filled (detail "error": the LaTeX doesn't parse) */
export const CM5_FILLED_EVENT = "web-laas:cm5-filled";

interface Pos {
  line: number;
  ch: number;
}
interface Mark {
  clear(): void;
  changed(): void;
  find(): { from: Pos; to: Pos } | undefined;
}
interface CM5 {
  getValue(): string;
  getOption(name: string): unknown;
  getViewport(): { from: number; to: number };
  listSelections(): { anchor: Pos; head: Pos }[];
  indexFromPos(pos: Pos): number;
  posFromIndex(index: number): Pos;
  markText(from: Pos, to: Pos, options: object): Mark;
  setCursor(pos: Pos): void;
  focus(): void;
  on(event: string, f: () => void): void;
  off(event: string, f: () => void): void;
}

/** Markdown editors only: in code (classic Jupyter's cells) a $ is code. */
const MARKDOWN_MODE = /markdown|gfm|frontmatter|hackmd|mdx/i;

/** How far past the drawn lines formulas are marked (scrolling stays smooth). */
const MARGIN_LINES = 60;

class Session {
  /** marks by the formula they cover */
  private marks = new Map<HTMLElement, { mark: Mark; latex: string }>();
  private queued = false;
  private readonly schedule = () => {
    if (this.queued) return;
    this.queued = true;
    // (a timer, not a frame: it runs in a window in the background too)
    setTimeout(() => {
      this.queued = false;
      this.update();
    }, 16);
  };

  constructor(
    readonly cm: CM5,
    readonly wrapper: HTMLElement,
    private owner: CM5Math,
  ) {
    for (const e of ["changes", "cursorActivity", "viewportChange", "focus", "blur"]) cm.on(e, this.schedule);
    wrapper.dataset.webLaasNative = "";
    this.schedule();
  }

  destroy() {
    for (const e of ["changes", "cursorActivity", "viewportChange", "focus", "blur"]) this.cm.off(e, this.schedule);
    for (const { mark } of this.marks.values()) mark.clear();
    this.marks.clear();
    delete this.wrapper.dataset.webLaasNative;
  }

  /** preview.js filled `span`: the line's height and width changed */
  filled(span: HTMLElement, error: boolean) {
    const m = this.marks.get(span);
    if (!m) return;
    if (error) {
      this.owner.bad.add(m.latex);
      m.mark.clear();
      this.marks.delete(span);
    } else m.mark.changed();
  }

  has(span: HTMLElement) {
    return this.marks.has(span);
  }

  private update() {
    const cm = this.cm;
    const text = cm.getValue();
    const view = cm.getViewport();
    const lo = cm.indexFromPos({ line: Math.max(0, view.from - MARGIN_LINES), ch: 0 });
    const hi = cm.indexFromPos({ line: view.to + MARGIN_LINES, ch: 0 });
    const sels = cm.listSelections().map((r) => {
      const a = cm.indexFromPos(r.anchor);
      const b = cm.indexFromPos(r.head);
      return [Math.min(a, b), Math.max(a, b)];
    });
    // the formulas to show rendered, by where they are
    const want = new Map<string, { from: number; to: number; latex: string; display: boolean; env?: string; at: number }>();
    for (const f of findFormulas(text, { comments: this.owner.comments })) {
      if (f.to < lo || f.from > hi) continue;
      // the caret (or a selection) touching it: its source
      if (sels.some(([a, b]) => a <= f.to && b >= f.from)) continue;
      if (this.owner.bad.has(f.latex)) continue;
      const opener = /^(?:\$\$|\$|\\[([]|\\begin\s*\{[^}]*\})/.exec(text.slice(f.from, f.from + 40))?.[0].length ?? 1;
      want.set(`${f.from}:${f.to}`, { ...f, at: f.from + opener });
    }
    // keep the marks still over the same formula (the editor moves them along with edits)
    for (const [span, m] of this.marks) {
      const r = m.mark.find();
      const key = r && `${cm.indexFromPos(r.from)}:${cm.indexFromPos(r.to)}`;
      if (key && want.get(key)?.latex === m.latex) want.delete(key);
      else {
        m.mark.clear();
        this.marks.delete(span);
      }
    }
    if (!want.size) return;
    for (const f of want.values()) {
      const span = document.createElement("span");
      span.className = f.display ? "web-laas-math web-laas-display" : "web-laas-math";
      span.dataset.webLaasMath = f.latex;
      if (f.display) span.dataset.display = "";
      if (f.env) span.dataset.env = f.env;
      span.addEventListener("mousedown", (e) => {
        e.preventDefault();
        // where the formula is now (edits before it moved the mark), just inside its opener
        const mark = this.marks.get(span)?.mark;
        const r = mark?.find();
        const at = r ? cm.indexFromPos(r.from) + (f.at - f.from) : f.at;
        // the source first: the caret can't go inside a collapsed mark
        mark?.clear();
        this.marks.delete(span);
        cm.setCursor(cm.posFromIndex(at));
        cm.focus();
      });
      const mark = cm.markText(cm.posFromIndex(f.from), cm.posFromIndex(f.to), {
        replacedWith: span,
        handleMouseEvents: false,
        clearWhenEmpty: true,
      });
      this.marks.set(span, { mark, latex: f.latex });
    }
    document.dispatchEvent(new CustomEvent(CM5_FILL_EVENT));
  }
}

export class CM5Math {
  private sessions = new Map<CM5, Session>();
  private on = false;
  private timer = 0;
  comments = false;
  /** LaTeX that doesn't parse: left as source (until it's edited into something else) */
  readonly bad = new Set<string>();

  constructor() {
    document.addEventListener(
      CM5_FILLED_EVENT,
      (e) => {
        const span = e.composedPath()[0];
        if (!(span instanceof HTMLElement)) return;
        for (const s of this.sessions.values()) {
          if (s.has(span)) return s.filled(span, (e as CustomEvent<string>).detail === "error");
        }
      },
      true,
    );
  }

  set(on: boolean, comments: boolean) {
    if (comments !== this.comments) this.clear();
    this.comments = comments;
    this.on = on;
    clearInterval(this.timer);
    if (!on) return this.clear();
    this.scan();
    // the editor shows up (and gets replaced) as the app moves between notes
    this.timer = window.setInterval(() => this.scan(), 1500);
  }

  private clear() {
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
  }

  private scan() {
    if (!this.on) return;
    for (const [cm, s] of this.sessions) {
      if (!s.wrapper.isConnected) {
        s.destroy();
        this.sessions.delete(cm);
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>(".CodeMirror")) {
      const cm = (el as HTMLElement & { CodeMirror?: CM5 }).CodeMirror;
      if (!cm || this.sessions.has(cm)) continue;
      const mode = cm.getOption("mode");
      const name = typeof mode === "string" ? mode : (mode as { name?: string } | null)?.name ?? "";
      if (!MARKDOWN_MODE.test(name)) continue;
      this.sessions.set(cm, new Session(cm, el, this));
    }
    if (this.bad.size > 500) this.bad.clear();
  }
}
