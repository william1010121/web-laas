// The live LaTeX preview: a small floating card that renders the formula under
// the caret, marks where the caret is, and stays out of the way of the mouse.
import { renderMath } from "../shared/math";
import { accentColor, themeCss } from "../shared/theme";

export type PreviewMode = "above" | "below" | "corner";

export interface PreviewFormula {
  latex: string;
  caret: number;
  display: boolean;
  env?: string;
  rect: { left: number; top: number; bottom: number } | null;
  /** identifies the formula (editor + start); a new id starts afresh */
  id?: string;
}

const ALIGNED = /^(align|flalign|eqnarray|split)\*?$/;
const ALIGNAT = /^(x?x?alignat)\*?$/;
const GATHERED = /^(gather|multline)\*?$/;

/** LaTeX to render: with a caret mark (when it can sit there) and without. */
export function prepareLatex(f: Pick<PreviewFormula, "latex" | "caret" | "env">, accent: string) {
  const fill = (s: string) => s.replace(/\{\}/g, `{\\color{${accent}}\\square}`);
  // alignat's {n} column count belongs to the alignedat wrapper, not the body
  const cols = f.env && ALIGNAT.test(f.env) ? /^\s*\{\s*\d+\s*\}/.exec(f.latex)?.[0] ?? "" : "";
  if (cols && f.caret < cols.length) f = { ...f, caret: cols.length };
  const body = f.latex.slice(cols.length);
  const caret = f.caret - cols.length;
  const wrap = (s: string) =>
    cols
      ? `\\begin{alignedat}${cols.trim()}${s}\\end{alignedat}`
      : f.env && ALIGNED.test(f.env)
      ? `\\begin{aligned}${s}\\end{aligned}`
      : f.env && GATHERED.test(f.env)
        ? `\\begin{gathered}${s}\\end{gathered}`
        : s;
  const before = body.slice(0, caret);
  const after = body.slice(caret);
  // not in the middle of a \command name, nor right after a lone backslash
  const midCommand = /\\[A-Za-z]*$/.test(before) && (/^[A-Za-z]/.test(after) || /\\$/.test(before));
  // a solid bar, wider than a \\vert so it reads as the caret at a glance
  // (fixCaretMark moves it down to sit on the text line)
  const mark = `{\\color{${accent}}\\rule{${MARK_WIDTH}}{1em}}`;
  return {
    withCaret: midCommand ? null : wrap(fill(before) + mark + fill(after)),
    plain: wrap(fill(body)),
  };
}

// an odd width singles the caret rule out in the MathML
const MARK_WIDTH = "0.0901em";

/** KaTeX gives \rule a zero-height box above the baseline; make the caret span ascender to descender. */
export function fixCaretMark(mathml: string): string {
  return mathml.replace(
    new RegExp(`<mpadded[^>]*>(<mspace mathbackground="[^"]*") width="${MARK_WIDTH}" height="1em"></mspace></mpadded>`),
    `$1 width="0.09em" height="0.8em" depth="0.25em"></mspace>`,
  );
}

const CSS = `
${themeCss(".lw-preview")}
:host { all: initial; }
.lw-preview {
  position: fixed; left: 0; top: 0; z-index: 2147483646;
  pointer-events: none; opacity: 0;
  transition: opacity .1s ease;
  font: 13px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", sans-serif;
}
.lw-preview.on { opacity: 1; }
.card {
  position: relative;
  box-sizing: border-box;
  max-width: min(620px, calc(100vw - 24px));
  max-height: calc(100vh - 16px);
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--lw-surface);
  border: 1px solid var(--lw-line-2);
  box-shadow: var(--lw-shadow-pop);
  color: var(--lw-math);
  overflow: hidden;
}
.math { font-size: 22px; white-space: nowrap; transition: opacity .12s ease; }
.math math { color: inherit; }
.math math[display="block"] { margin: 2px 0; }
.stale .math { opacity: .5; }
.badge {
  display: none; position: absolute; top: 6px; right: 8px;
  font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
  padding: 1px 6px; border-radius: 6px;
  color: var(--lw-muted); background: var(--lw-sunken); border: 1px solid var(--lw-line);
}
.stale .badge { display: block; }
@media (prefers-reduced-motion: reduce) { .lw-preview, .math { transition: none; } }
`;

const GAP = 10;
const MARGIN = 8;

export class LivePreview {
  private host: HTMLElement;
  private root: HTMLElement;
  private card: HTMLElement;
  private math: HTMLElement;
  private mode: PreviewMode = "above";
  private shownHtml = "";
  private formulaId: string | undefined;
  private last: PreviewFormula | null = null;
  private dismissed: string | null = null;
  visible = false;

  constructor(private doc: Document) {
    this.host = doc.createElement("div");
    this.host.setAttribute("data-web-laas-preview", "");
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = CSS;
    this.root = doc.createElement("div");
    this.root.className = "lw-preview";
    this.root.setAttribute("aria-hidden", "true");
    this.card = doc.createElement("div");
    this.card.className = "card";
    this.math = doc.createElement("div");
    this.math.className = "math";
    const badge = doc.createElement("span");
    badge.className = "badge";
    badge.textContent = "未完成";
    this.card.append(this.math, badge);
    this.root.append(this.card);
    shadow.append(style, this.root);
  }

  setMode(mode: PreviewMode) {
    this.mode = mode;
    if (this.last) this.place(this.last);
  }

  /** Esc: hide until the formula changes. */
  dismiss() {
    this.dismissed = this.last?.latex ?? null;
    this.hide();
  }

  hide() {
    this.visible = false;
    this.root.classList.remove("on");
  }

  update(f: PreviewFormula | null) {
    this.last = f;
    if (!f || !f.latex.trim()) {
      // leaving the formula: its last good render must not stand in for the next one
      this.shownHtml = "";
      this.math.innerHTML = "";
      this.dismissed = null; // Esc hides this formula, not the next one with the same text
      this.formulaId = undefined;
      return this.hide();
    }
    if (f.id !== this.formulaId) {
      // another formula: Esc and the last good render belonged to the previous one
      this.formulaId = f.id;
      this.dismissed = null;
      this.shownHtml = "";
      this.math.innerHTML = "";
    }
    if (this.dismissed !== null) {
      if (f.latex === this.dismissed) return;
      this.dismissed = null;
    }
    const { withCaret, plain } = prepareLatex(f, accentColor());
    const marked = withCaret && renderMath(withCaret, f.display);
    const html = marked ? fixCaretMark(marked) : renderMath(plain, f.display);
    if (html) {
      if (html !== this.shownHtml) {
        this.math.innerHTML = html;
        this.shownHtml = html;
      }
      this.card.classList.remove("stale");
    } else if (this.shownHtml) {
      this.card.classList.add("stale"); // half-typed: keep the last good render, dimmed
    } else {
      return this.hide();
    }
    if (!this.host.isConnected) (this.doc.body ?? this.doc.documentElement).append(this.host);
    this.fit();
    this.place(f);
    this.visible = true;
    this.root.classList.add("on");
  }

  /** Shrink a formula wider than the card, or taller than the window, instead of cutting it off. */
  private fit() {
    this.math.style.zoom = "1";
    const maxW = this.card.clientWidth - 32;
    const maxH = this.doc.defaultView!.innerHeight - 2 * MARGIN - 24; // the card's padding and border
    const w = this.math.scrollWidth;
    const h = this.math.scrollHeight;
    let zoom = 1;
    // no floor: the card can't scroll, so all of the formula has to fit
    if (w > maxW && maxW > 0) zoom = maxW / w;
    if (h * zoom > maxH && maxH > 0) zoom = maxH / h;
    if (zoom < 1) this.math.style.zoom = String(zoom);
  }

  private place(f: PreviewFormula) {
    const view = this.doc.defaultView!;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    let left: number;
    let top: number;
    const r = f.rect;
    if (this.mode === "corner" || !r) {
      left = Math.max(MARGIN, vw - w - 16);
      top = Math.max(MARGIN, vh - h - 16);
    } else {
      left = Math.min(Math.max(MARGIN, r.left - 18), vw - w - MARGIN);
      const above = r.top - h - GAP;
      const below = r.bottom + GAP;
      const fitsAbove = above >= MARGIN;
      const fitsBelow = below + h <= vh - MARGIN;
      if (this.mode === "above") top = fitsAbove || !fitsBelow ? above : below;
      else top = fitsBelow || !fitsAbove ? below : above;
      // a card taller than the window keeps its top row on screen
      top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    }
    this.root.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  destroy() {
    this.host.remove();
  }
}
