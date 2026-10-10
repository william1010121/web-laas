// preview.js: injected into a frame (by the background) the first time its
// caret enters math, so KaTeX isn't loaded into pages that never need it.
import { alive } from "../shared/alive";
import { loadState } from "../shared/storage";
import { LivePreview, type PreviewFormula, type PreviewMode } from "./preview";

declare global {
  interface Window {
    __webLaasPreviewAlive?: () => boolean;
  }
}

if (!window.__webLaasPreviewAlive?.()) {
  window.__webLaasPreviewAlive = alive;
  // an extension update leaves the previous build's card in the page: take it down
  document.querySelectorAll("[data-web-laas-preview]").forEach((el) => el.remove());
  const preview = new LivePreview(document);
  let mode: PreviewMode | "off" = "above";

  const apply = async () => {
    const { prefs, enabled } = await loadState();
    mode = enabled ? prefs.preview : "off";
    if (mode === "off") preview.hide();
    else preview.setMode(mode);
  };
  void apply();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.prefs || changes.enabled)) void apply();
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
