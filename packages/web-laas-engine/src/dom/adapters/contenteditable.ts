import type { CaretRect, EditorAdapter } from "./types";

// contenteditable editors (ProseMirror: ChatGPT / Claude, Notion, Lexical, …).
// The DOM is linearized into plain text: text nodes as-is, <br> as "\n",
// a "\n" between block elements, non-editable islands as U+FFFC.
// Edits go through execCommand so the editor framework sees normal input.

const BLOCK =
  /^(P|DIV|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER|DD|DT|DL|FIGURE|HR)$/;
const SKIP = /^(STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/;

interface Seg {
  start: number;
  len: number;
  node: Node;
  atom: boolean;
}

interface Linear {
  text: string;
  segs: Seg[];
  found: number | null;
}

function linearize(root: Element, target?: { node: Node; offset: number }): Linear {
  let text = "";
  const segs: Seg[] = [];
  let found: number | null = null;

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (target && target.node === node) found = text.length + Math.min(target.offset, data.length);
      segs.push({ start: text.length, len: data.length, node, atom: false });
      text += data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.test(el.tagName)) return;
    if (el !== root && el.getAttribute("contenteditable") === "false") {
      if (target && found === null && el.contains(target.node)) found = text.length;
      segs.push({ start: text.length, len: 1, node: el, atom: true });
      text += "￼";
      return;
    }
    if (el.tagName === "BR") {
      segs.push({ start: text.length, len: 1, node: el, atom: true });
      text += "\n";
      return;
    }
    if (el !== root && BLOCK.test(el.tagName) && text.length > 0 && !text.endsWith("\n")) text += "\n";
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (target && target.node === el && target.offset === i && found === null) found = text.length;
      visit(kids[i]);
    }
    if (target && target.node === el && target.offset >= kids.length && found === null) found = text.length;
  };
  visit(root);
  return { text, segs, found };
}

function domPosition(root: Element, segs: Seg[], offset: number): [Node, number] {
  for (const s of segs) {
    if (!s.atom && offset >= s.start && offset <= s.start + s.len) return [s.node, offset - s.start];
  }
  for (const s of segs) {
    const parent = s.node.parentNode;
    if (!parent) continue;
    const idx = Array.prototype.indexOf.call(parent.childNodes, s.node);
    if (s.start === offset) return [parent, idx];
    if (s.start + s.len === offset) return [parent, idx + 1];
  }
  return [root, root.childNodes.length];
}

export function editingHost(el: Element): HTMLElement | null {
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  let host: HTMLElement = el;
  while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
  return host;
}

export class ContentEditableAdapter implements EditorAdapter {
  readonly kind = "contenteditable";
  private cache: Linear | null = null;

  constructor(private root: HTMLElement) {}
  get id() {
    return this.root;
  }

  private lin(): Linear {
    if (!this.cache) {
      this.cache = linearize(this.root);
      queueMicrotask(() => (this.cache = null));
    }
    return this.cache;
  }

  private offsetOf(node: Node | null, offset: number): number | null {
    if (!node || !this.root.contains(node)) return null;
    return linearize(this.root, { node, offset }).found;
  }

  getSelection() {
    const sel = this.root.ownerDocument.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const a = this.offsetOf(sel.anchorNode, sel.anchorOffset);
    const f = sel.isCollapsed ? a : this.offsetOf(sel.focusNode, sel.focusOffset);
    if (a === null || f === null) return null;
    return { from: Math.min(a, f), to: Math.max(a, f) };
  }
  getLength() {
    return this.lin().text.length;
  }
  textBefore(pos: number, max: number) {
    return this.lin().text.slice(Math.max(0, pos - max), pos);
  }
  slice(from: number, to: number) {
    return this.lin().text.slice(from, to);
  }
  replace(from: number, to: number, text: string, selFrom: number, selTo: number) {
    this.setSelection(from, to);
    const doc = this.root.ownerDocument;
    // Where whitespace collapses, "a  b" would lose a space (and the caret
    // between the two): keep runs visible the way browsers do, with nbsp.
    const ws = doc.defaultView?.getComputedStyle(this.root).whiteSpace ?? "pre-wrap";
    if (ws === "normal" || ws === "nowrap") text = text.replace(/ {2}/g, " \u00a0");
    if (text) doc.execCommand("insertText", false, text);
    else if (from !== to) doc.execCommand("delete", false);
    this.cache = null;
    this.setSelection(selFrom, selTo);
  }
  caretRect(): CaretRect | null {
    const doc = this.root.ownerDocument;
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !this.root.contains(sel.focusNode)) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    if (rects.length) {
      const r = rects[rects.length - 1];
      return { left: r.left, top: r.top, bottom: r.bottom };
    }
    // a collapsed range at a node boundary has no box: measure the character before it
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      const r2 = doc.createRange();
      r2.setStart(node, range.startOffset - 1);
      r2.setEnd(node, range.startOffset);
      const b = r2.getBoundingClientRect();
      return { left: b.right, top: b.top, bottom: b.bottom };
    }
    // at an element boundary (or offset 0): the edge of the node next to the caret
    const near = (n: Node | null, side: "before" | "after"): CaretRect | null => {
      if (!n) return null;
      const r2 = doc.createRange();
      if (n.nodeType === Node.TEXT_NODE && n.textContent) {
        const len = n.textContent.length;
        if (side === "before") r2.setStart(n, len - 1), r2.setEnd(n, len);
        else r2.setStart(n, 0), r2.setEnd(n, 1);
      } else r2.selectNode(n);
      const b = r2.getBoundingClientRect();
      if (!b.width && !b.height) return null;
      return { left: side === "before" ? b.right : b.left, top: b.top, bottom: b.bottom };
    };
    const at = node.nodeType === Node.ELEMENT_NODE ? range.startOffset : -1;
    const hit =
      at >= 0
        ? near(node.childNodes[at - 1] ?? null, "before") ?? near(node.childNodes[at] ?? null, "after")
        : near(node.previousSibling, "before") ?? near(node.nextSibling ?? node, "after");
    if (hit) return hit;
    const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
    const b = (el ?? this.root).getBoundingClientRect();
    return { left: b.left, top: b.top, bottom: Math.min(b.bottom, b.top + 24) };
  }
  setSelection(from: number, to: number) {
    const { segs } = linearize(this.root);
    const [an, ao] = domPosition(this.root, segs, from);
    const [fn, fo] = from === to ? [an, ao] : domPosition(this.root, segs, to);
    const sel = this.root.ownerDocument.getSelection();
    if (!sel) return;
    sel.setBaseAndExtent(an, ao, fn, fo);
  }
}
