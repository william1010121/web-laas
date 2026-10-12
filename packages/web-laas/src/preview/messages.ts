// Sent messages on chat sites: ChatGPT, Claude and Gemini typeset their own
// replies but show what you sent as plain text, $…$ and all. A message with math
// is hidden and a copy with its formulas typeset goes right after it. The page's
// own nodes are never changed (React or Angular keep updating them): when the
// message changes or goes away, so does the copy. Copying from the copy gives the
// LaTeX source back.
import { findFormulas } from "web-laas-engine";
import { MATH_CSS, renderMath } from "../shared/math";
import { domText } from "./inline";
export { messageSelector } from "../shared/chat";
import { prepareLatex } from "./preview";

const MATH_HINT = /\$|\\[([]|\\begin\s*\{/;
const SOURCE = "data-web-laas-msg";
const COPY = "data-web-laas-msg-copy";
const STYLE_ID = "web-laas-msg-style";
const CSS = `
[${SOURCE}] { display: none !important; }
[${COPY}] mjx-container[display="true"] { display: block; margin: 0.5em 0; text-align: center; max-width: 100%; overflow-x: auto; overflow-y: hidden; }
[${COPY}] mjx-container { color: inherit; }
${MATH_CSS.replace(/^mjx-container/gm, `[${COPY}] mjx-container`)}
`;

interface Shown {
  copy: HTMLElement;
  /** the message's text when it was typeset */
  text: string;
}

export class MessageRender {
  private on = false;
  private shown = new Map<Element, Shown>();
  private observer: MutationObserver | null = null;
  private timer = 0;
  private readonly onCopy = (e: ClipboardEvent) => this.copySource(e);

  constructor(
    private readonly doc: Document,
    private readonly selector: string,
  ) {}

  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
      this.doc.addEventListener("copy", this.onCopy, true);
      this.schedule();
    } else {
      this.destroy();
    }
  }

  destroy() {
    this.on = false;
    this.observer?.disconnect();
    this.observer = null;
    clearTimeout(this.timer);
    this.doc.removeEventListener("copy", this.onCopy, true);
    for (const [source, { copy }] of this.shown) this.restore(source, copy);
    this.shown.clear();
    this.doc.getElementById(STYLE_ID)?.remove();
  }

  // a reply streaming in changes the page many times a second: look once things settle
  private schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.scan(), 150);
  }

  private scan() {
    if (!this.on) return;
    // our own changes would wake the observer again
    this.observer?.disconnect();
    try {
      for (const [source, { copy }] of this.shown) {
        // gone, or the page moved things around: take the copy down
        if (!source.isConnected || source.nextElementSibling !== copy) {
          this.restore(source, copy);
          this.shown.delete(source);
        }
      }
      for (const source of this.doc.querySelectorAll(this.selector)) {
        // our copies keep the page's attributes and classes: they match too
        if (!source.closest(`[${COPY}]`)) this.update(source);
      }
    } finally {
      this.observer?.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  private update(source: Element) {
    const text = source.textContent ?? "";
    const had = this.shown.get(source);
    if (had?.text === text) return;
    if (had) {
      this.restore(source, had.copy);
      this.shown.delete(source);
    }
    if (!MATH_HINT.test(text)) return;
    const copy = typeset(source);
    if (!copy) return;
    this.ensureStyle();
    source.after(copy);
    source.setAttribute(SOURCE, "");
    this.shown.set(source, { copy, text });
  }

  private restore(source: Element, copy: HTMLElement) {
    copy.remove();
    source.removeAttribute(SOURCE);
  }

  private ensureStyle() {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (this.doc.head ?? this.doc.documentElement).append(style);
  }

  /** Copying across typeset formulas gives their LaTeX, as it was sent. */
  private copySource(e: ClipboardEvent) {
    const sel = this.doc.getSelection();
    if (!sel || sel.isCollapsed || !e.clipboardData) return;
    const range = sel.getRangeAt(0);
    const touched = [...this.shown.values()].some(({ copy }) => range.intersectsNode(copy));
    if (!touched) return;
    const frag = range.cloneContents();
    for (const m of frag.querySelectorAll<HTMLElement>("[data-latex]")) m.replaceWith(m.dataset.latex ?? "");
    const holder = this.doc.createElement("div");
    holder.append(frag);
    // block elements end lines, as they did on the page
    for (const b of holder.querySelectorAll("p, div, li, br")) b.after("\n");
    e.clipboardData.setData("text/plain", holder.textContent?.replace(/\n{3,}/g, "\n\n").replace(/\n$/, "") ?? "");
    e.preventDefault();
  }
}

/** A copy of `source` with its formulas typeset, or null when none render. */
function typeset(source: Element): HTMLElement | null {
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  copy.setAttribute(COPY, "");
  // a label for screen readers repeats the message, cut short (Gemini's "You said $$…"): its
  // unclosed $$ would pair up with the message's own
  for (const el of copy.querySelectorAll(".cdk-visually-hidden, .sr-only, .visually-hidden")) el.remove();
  const t = domText(copy);
  const formulas = findFormulas(t.text);
  if (!formulas.length) return null;
  const at = (pos: number, end: boolean): [Text, number] | null => {
    // the text node a position falls in (the end of a range: the one it closes)
    let seg = t.segs[0];
    for (const s of t.segs) {
      if (end ? s.start < pos : s.start <= pos) seg = s;
      else break;
    }
    return seg ? [seg.node, Math.min(Math.max(0, pos - seg.start), seg.node.data.length)] : null;
  };
  let drawn = 0;
  // from the last one back: the earlier ones' text nodes stay where they were
  for (const f of [...formulas].reverse()) {
    const latex = prepareLatex({ latex: f.latex, caret: 0, env: f.env }, "").plain;
    const html = renderMath(latex, f.display);
    const start = at(f.from, false);
    const end = at(f.to, true);
    if (!html || !start || !end) continue;
    const range = source.ownerDocument.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    const math = source.ownerDocument.createElement("span");
    math.dataset.latex = t.text.slice(f.from, f.to);
    // the original is hidden from screen readers too: they read the source
    math.setAttribute("role", "img");
    math.setAttribute("aria-label", f.latex);
    math.innerHTML = html;
    range.deleteContents();
    range.insertNode(math);
    drawn++;
  }
  return drawn ? copy : null;
}
