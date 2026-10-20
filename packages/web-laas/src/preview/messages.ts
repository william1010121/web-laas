// Sent messages on chat sites: ChatGPT, Claude and Gemini typeset their own
// replies but show what you sent as plain text, $…$ and all. A message with math
// is hidden and a copy with its formulas typeset goes right after it. The page's
// own nodes are never changed (React or Angular keep updating them): when the
// message changes or goes away, so does the copy. Each formula keeps its source
// as text that is out of sight but copied (and read by screen readers), so copying
// gives the LaTeX back, also in a selection that runs on into the reply.
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
[${COPY}] mjx-container { color: inherit; user-select: none; }
[${COPY}] [data-latex] { position: relative; }
[${COPY}] .web-laas-src { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: pre; }
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
  private lastScan = -Infinity;
  private batchTimer = 0;
  private pending: Element[] = [];

  constructor(
    private readonly doc: Document,
    private readonly selector: string,
  ) {}

  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      // (typing in the message box changes only it, or our own elements: no need to look at every message again)
      this.observer = new MutationObserver((records) => {
        if (records.some((r) => !inEditable(r.target) && !inOurs(r.target))) this.schedule();
      });
      this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
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
    clearTimeout(this.batchTimer);
    this.pending = [];
    for (const [source, { copy }] of this.shown) this.restore(source, copy);
    this.shown.clear();
    this.doc.getElementById(STYLE_ID)?.remove();
  }

  // a reply streaming in changes the page many times a second: look once things settle, and
  // at most once a second (each look reads every sent message of the conversation)
  private schedule() {
    clearTimeout(this.timer);
    const wait = Math.max(150, this.lastScan + 1000 - performance.now());
    this.timer = window.setTimeout(() => this.scan(), wait);
  }

  private scan() {
    if (!this.on) return;
    this.lastScan = performance.now();
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
      clearTimeout(this.batchTimer);
      const visible: Element[] = [];
      const rest: Element[] = [];
      const height = this.doc.defaultView?.innerHeight ?? 0;
      for (const source of this.doc.querySelectorAll(this.selector)) {
        // our copies keep the page's attributes and classes: they match too
        if (source.closest(`[${COPY}]`)) continue;
        const text = source.textContent ?? "";
        if (this.shown.get(source)?.text === text) continue;
        if (!this.shown.has(source) && !MATH_HINT.test(text)) continue;
        const box = (this.shown.get(source)?.copy ?? source).getBoundingClientRect();
        (box.bottom >= 0 && box.top <= height ? visible : rest).push(source);
      }
      this.pending = [...visible, ...rest];
    } finally {
      this.observer?.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
    }
    this.batch();
  }

  private batch() {
    if (!this.on) return;
    const started = performance.now();
    this.observer?.disconnect();
    try {
      let count = 0;
      // One message is atomic (never hide partially rendered source). Yield
      // between messages after 8 ms or four messages, whichever comes first.
      while (this.pending.length && count < 4 && (count === 0 || performance.now() - started < 8)) {
        const source = this.pending.shift()!;
        if (source.isConnected) this.update(source);
        count++;
      }
    } finally {
      this.observer?.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
    }
    if (this.pending.length) this.batchTimer = window.setTimeout(() => this.batch(), 0);
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
}

/** Is `node` inside an editor (a text field, or editable content)? */
function inEditable(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el as HTMLElement).isContentEditable);
}

/** Is `node` inside an element web-laas put in the page (the composer, render layers, the preview card)? */
function inOurs(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest("[data-web-laas-composer], [data-web-laas-render], [data-web-laas-preview], [data-web-laas-mirror]");
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
    math.innerHTML = html;
    // the SVG isn't selected, its source is: that's what copying (and a screen reader) gets
    const src = source.ownerDocument.createElement("span");
    src.className = "web-laas-src";
    src.textContent = math.dataset.latex;
    math.firstElementChild?.setAttribute("aria-hidden", "true");
    math.prepend(src);
    range.deleteContents();
    range.insertNode(math);
    drawn++;
  }
  return drawn ? copy : null;
}
