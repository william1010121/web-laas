// preview.js: injected into a frame (by the background) the first time its
// caret enters math, so MathJax isn't loaded into pages that never need it.
import { compileConfig, hostMatches } from "web-laas-engine";
import { alive } from "../shared/alive";
import { loadState, STORAGE_KEYS } from "../shared/storage";
import { InlineRender } from "./inline";
import { LivePreview, type PreviewFormula, type PreviewMode } from "./preview";

declare global {
  interface Window {
    __webLaasPreviewAlive?: () => boolean;
  }
}

/** Sent when a new preview.js starts: an orphaned one from before an extension update stops. */
const HANDOVER_EVENT = "web-laas:preview-handover";

if (!window.__webLaasPreviewAlive?.()) {
  window.__webLaasPreviewAlive = alive;
  // the previous build (another isolated world after an update) stops its renderer and takes down
  // its card; whatever it left on the page goes too
  document.dispatchEvent(new CustomEvent(HANDOVER_EVENT));
  document.querySelectorAll("[data-web-laas-preview], [data-web-laas-render], [data-web-laas-mirror]").forEach((el) => el.remove());
  const preview = new LivePreview(document);
  // the main-world script reads CodeMirror's undrawn lines for us (events cross worlds synchronously)
  const undrawn = (root: Element, comments: boolean): string[] | null => {
    let reply: string | null = null;
    const onReply = (e: Event) => (reply = (e as CustomEvent<string>).detail);
    root.addEventListener("web-laas:undrawn-reply", onReply);
    root.dispatchEvent(new CustomEvent("web-laas:undrawn", { bubbles: true, detail: comments ? "comments" : "" }));
    root.removeEventListener("web-laas:undrawn-reply", onReply);
    try {
      return reply ? (JSON.parse(reply) as string[]) : null;
    } catch {
      return null;
    }
  };
  const rendered = new InlineRender(document, { undrawn, alive });
  document.addEventListener(HANDOVER_EVENT, () => {
    rendered.destroy();
    preview.destroy();
  });
  let mode: PreviewMode | "off" = "above";

  const apply = async () => {
    const { prefs, enabled, disabledHosts, configText } = await loadState();
    if (!alive()) return rendered.destroy();
    const host = location.hostname;
    let config = null;
    try {
      config = compileConfig(configText).config;
    } catch {}
    // off where the engine is off: the toolbar's list, and the config's own disabledSites
    const on =
      enabled && ![...disabledHosts, ...(config?.disabledSites ?? [])].some((p) => hostMatches(host, p));
    mode = on ? prefs.preview : "off";
    if (mode === "off") preview.hide();
    else preview.setMode(mode);
    const comments = !!config?.latexCommentSites.some((p) => hostMatches(host, p));
    rendered.set({ on: on && prefs.inlineRender, comments });
  };
  void apply();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => (STORAGE_KEYS as readonly string[]).includes(k))) void apply();
  });

  document.addEventListener("web-laas:formula", (e) => {
    if (mode === "off" || !alive()) return;
    try {
      preview.update(JSON.parse((e as CustomEvent<string>).detail) as PreviewFormula | null);
    } catch {
      preview.hide();
    }
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && preview.visible) preview.dismiss();
    },
    true,
  );
  // ask the main-world engine for the formula we may have missed while loading
  document.dispatchEvent(new CustomEvent("web-laas:preview-ready"));
}
