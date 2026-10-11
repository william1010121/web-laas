// Runs in the page's MAIN world so it can reach editor instances
// (CodeMirror views etc.). Settings arrive from the isolated-world script.
//
// When the extension is reloaded, the background injects this script again
// into open tabs, where the previous version is still running (page-world
// scripts survive an extension reload). A different build replaces it.
import { LaasController, undrawnParagraphs, type RuntimeState } from "web-laas-engine/dom";

declare const __WEB_LAAS_BUILD__: string;

/** Event names of this protocol (v2). The old "laasweb:*" names belong to builds before it. */
export const STATE_EVENT = "web-laas:state";
export const READY_EVENT = "web-laas:ready";
export const FORMULA_EVENT = "web-laas:formula";
export const PREVIEW_READY_EVENT = "web-laas:preview-ready";
/** preview.js asks (on a CodeMirror element) for its undrawn paragraphs; the reply comes back on it at once */
export const UNDRAWN_EVENT = "web-laas:undrawn";
export const UNDRAWN_REPLY_EVENT = "web-laas:undrawn-reply";

declare global {
  interface Window {
    __webLaas?: { build: string; detach: () => void };
  }
}

const current = window.__webLaas;
if (current?.build !== __WEB_LAAS_BUILD__) {
  current?.detach(); // an older build in this page: hand over

  // Live preview: the engine reports the formula under the caret; preview.js
  // (isolated world, injected on first use) draws it.
  const sendFormula = (f: unknown) =>
    document.dispatchEvent(new CustomEvent(FORMULA_EVENT, { detail: JSON.stringify(f) }));
  const controller = new LaasController({ onFormula: sendFormula });
  const detachKeys = controller.attach();
  const onState = (e: Event) => {
    try {
      const state = JSON.parse((e as CustomEvent<string>).detail) as Partial<RuntimeState> & {
        prefs?: { preview?: string };
      };
      controller.setState(state);
      // preview off: the controller stops scanning for formulas altogether
      controller.watchFormula((state.prefs?.preview ?? "above") !== "off");
    } catch (err) {
      console.warn("[web-laas] bad state message", err);
    }
  };
  const onPreviewReady = () => controller.refreshFormula();
  // Rendering formulas in place (isolated world) can't see the lines CodeMirror
  // hasn't drawn; whether drawn text starts inside a formula is answered here.
  const onUndrawn = (e: Event) => {
    // (composedPath: from an editor in a shadow root the event's target here is the shadow host)
    const origin = e.composedPath()[0];
    const el = origin instanceof Element ? origin : null;
    const comments = (e as CustomEvent<string>).detail === "comments";
    const paragraphs = el && undrawnParagraphs(el, { comments });
    if (paragraphs) el.dispatchEvent(new CustomEvent(UNDRAWN_REPLY_EVENT, { detail: JSON.stringify(paragraphs) }));
  };
  document.addEventListener(STATE_EVENT, onState);
  document.addEventListener(PREVIEW_READY_EVENT, onPreviewReady);
  document.addEventListener(UNDRAWN_EVENT, onUndrawn, true);
  window.__webLaas = {
    build: __WEB_LAAS_BUILD__,
    detach: () => {
      detachKeys();
      document.removeEventListener(STATE_EVENT, onState);
      document.removeEventListener(PREVIEW_READY_EVENT, onPreviewReady);
      document.removeEventListener(UNDRAWN_EVENT, onUndrawn, true);
    },
  };
  document.documentElement.dataset.laasWeb = __WEB_LAAS_BUILD__;
  document.dispatchEvent(new CustomEvent(READY_EVENT));
}
