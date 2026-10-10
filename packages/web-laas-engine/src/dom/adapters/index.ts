import type { EditorAdapter } from "./types";
import { CM5Adapter, CM6Adapter, findCM5, findCM6View } from "./codemirror";
import { ContentEditableAdapter, editingHost } from "./contenteditable";
import { isTextField, TextFieldAdapter } from "./textarea";

export type { EditorAdapter };
export type { CaretRect } from "./types";
export { TextFieldAdapter } from "./textarea";
export { ContentEditableAdapter } from "./contenteditable";
export { CM5Adapter, CM6Adapter } from "./codemirror";

/** Returns an adapter for the focused element, or null if it is not that editor. */
export type AdapterFactory = (el: Element) => EditorAdapter | null;

/** The focused element, descending into open shadow roots (iframes run their own controller). */
export function deepActiveElement(doc: Document = document): Element | null {
  let el = doc.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

const cache = new WeakMap<object, EditorAdapter>();

function memo<T extends object>(key: T, make: () => EditorAdapter): EditorAdapter {
  let a = cache.get(key);
  if (!a) {
    a = make();
    cache.set(key, a);
  }
  return a;
}

export function adapterFor(el: Element | null, custom: AdapterFactory[] = []): EditorAdapter | null {
  if (!el || el === el.ownerDocument.body) return null;
  for (const make of custom) {
    const a = make(el);
    if (a) return a;
  }
  // Monaco (Colab etc.) is not supported yet: leave it alone.
  if (el.closest(".monaco-editor")) return null;

  const view = findCM6View(el);
  if (view) return memo(view, () => new CM6Adapter(view));
  const cm5 = findCM5(el);
  if (cm5) return memo(cm5, () => new CM5Adapter(cm5));
  if (el.closest(".cm-editor, .CodeMirror, .ace_editor")) return null;

  if (isTextField(el)) return memo(el, () => new TextFieldAdapter(el));
  const host = editingHost(el);
  if (host) return memo(host, () => new ContentEditableAdapter(host));
  return null;
}
