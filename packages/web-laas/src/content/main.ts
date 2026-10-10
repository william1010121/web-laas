// Runs in the page's MAIN world so it can reach editor instances
// (CodeMirror views etc.). Settings arrive from the isolated-world script.
//
// When the extension is reloaded, the background injects this script again
// into open tabs, where the previous version is still running (page-world
// scripts survive an extension reload). A different build replaces it.
import { LaasController, type RuntimeState } from "web-laas-engine/dom";

declare const __WEB_LAAS_BUILD__: string;

/** Event names of this protocol (v2). The old "laasweb:*" names belong to builds before it. */
export const STATE_EVENT = "web-laas:state";
export const READY_EVENT = "web-laas:ready";

declare global {
  interface Window {
    __webLaas?: { build: string; detach: () => void };
  }
}

const current = window.__webLaas;
if (current?.build !== __WEB_LAAS_BUILD__) {
  current?.detach(); // an older build in this page: hand over

  const controller = new LaasController();
  const detachKeys = controller.attach();
  const onState = (e: Event) => {
    try {
      controller.setState(JSON.parse((e as CustomEvent<string>).detail) as Partial<RuntimeState>);
    } catch (err) {
      console.warn("[web-laas] bad state message", err);
    }
  };
  document.addEventListener(STATE_EVENT, onState);
  window.__webLaas = {
    build: __WEB_LAAS_BUILD__,
    detach: () => {
      detachKeys();
      document.removeEventListener(STATE_EVENT, onState);
    },
  };
  document.documentElement.dataset.laasWeb = __WEB_LAAS_BUILD__;
  document.dispatchEvent(new CustomEvent(READY_EVENT));
}
