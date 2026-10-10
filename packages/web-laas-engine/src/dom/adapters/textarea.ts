import type { EditorAdapter } from "./types";

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
}
