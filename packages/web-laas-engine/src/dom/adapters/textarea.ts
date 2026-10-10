import type { CaretRect, EditorAdapter } from "./types";

// Styles that decide where text wraps and lines fall, copied onto a hidden mirror.
const MIRRORED = [
  "direction", "boxSizing", "width", "height", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle",
  "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing", "tabSize",
  "wordBreak", "overflowWrap",
] as const;

/** Caret position in a text field, measured on a hidden mirror element. */
function fieldCaretRect(el: HTMLTextAreaElement | HTMLInputElement, pos: number): CaretRect {
  const doc = el.ownerDocument;
  const cs = doc.defaultView!.getComputedStyle(el);
  const mirror = doc.createElement("div");
  const st = mirror.style as unknown as Record<string, string>;
  for (const p of MIRRORED) st[p] = cs[p as keyof CSSStyleDeclaration] as string;
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-99999px";
  mirror.style.overflow = "hidden";
  // wrap at the real text width: clientWidth leaves out a scrollbar the mirror doesn't have
  if (el.clientWidth > 0) {
    mirror.style.boxSizing = "border-box";
    mirror.style.width = `${el.clientWidth + parseFloat(cs.borderLeftWidth || "0") + parseFloat(cs.borderRightWidth || "0")}px`;
  }
  // wrap="off" (or white-space: pre) scrolls sideways instead of wrapping
  const wraps = el instanceof HTMLTextAreaElement && el.getAttribute("wrap") !== "off" && !/^pre$|nowrap/.test(cs.whiteSpace);
  mirror.style.whiteSpace = wraps ? "pre-wrap" : "pre";
  mirror.textContent = el.value.slice(0, pos);
  const marker = doc.createElement("span");
  marker.textContent = el.value.slice(pos) || ".";
  mirror.appendChild(marker);
  (doc.body ?? doc.documentElement).appendChild(mirror);
  const box = el.getBoundingClientRect();
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25 || 16;
  const top = box.top + parseFloat(cs.borderTopWidth || "0") + marker.offsetTop - el.scrollTop;
  const left = box.left + parseFloat(cs.borderLeftWidth || "0") + marker.offsetLeft - el.scrollLeft;
  mirror.remove();
  return { left, top, bottom: top + lineHeight };
}

type Field = HTMLTextAreaElement | HTMLInputElement;

export function isTextField(el: Element): el is Field {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ["text", "search", ""].includes(el.type) && el.selectionStart !== null;
  }
  return false;
}

export class TextFieldAdapter implements EditorAdapter {
  readonly kind = "textarea";
  constructor(private el: Field) {}
  get id() {
    return this.el;
  }
  getSelection() {
    const { selectionStart: a, selectionEnd: b } = this.el;
    if (a === null || b === null) return null;
    return { from: a, to: b };
  }
  getLength() {
    return this.el.value.length;
  }
  textBefore(pos: number, max: number) {
    return this.el.value.slice(Math.max(0, pos - max), pos);
  }
  slice(from: number, to: number) {
    return this.el.value.slice(from, to);
  }
  replace(from: number, to: number, text: string, selFrom: number, selTo: number) {
    const el = this.el;
    el.setSelectionRange(from, to);
    // execCommand keeps the native undo stack and notifies frameworks (React etc.)
    const doc = el.ownerDocument;
    let ok = false;
    try {
      if (typeof doc.execCommand === "function") {
        ok = text ? doc.execCommand("insertText", false, text) : from === to || doc.execCommand("delete", false);
      }
    } catch {
      ok = false;
    }
    if (!ok || el.value.slice(from, from + text.length) !== text) {
      el.setRangeText(text, from, to, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    el.setSelectionRange(selFrom, selTo);
  }
  setSelection(from: number, to: number) {
    this.el.setSelectionRange(from, to);
  }
  caretRect() {
    const pos = this.el.selectionEnd;
    return pos === null ? null : fieldCaretRect(this.el, pos);
  }
}
