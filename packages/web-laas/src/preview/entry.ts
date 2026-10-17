// preview.js: injected into a frame (by the background) the first time its
// caret enters math, so MathJax isn't loaded into pages that never need it.
import { compileConfig, hostMatches } from "web-laas-engine";
import { alive } from "../shared/alive";
import { loadState, STORAGE_KEYS } from "../shared/storage";
import { InlineRender } from "./inline";
import { MessageRender, messageSelector } from "./messages";
import { LivePreview, prepareLatex, type PreviewFormula, type PreviewMode } from "./preview";
import { MATH_CSS, renderMathElement } from "../shared/math";

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
  document.querySelectorAll("[data-web-laas-preview], [data-web-laas-render], [data-web-laas-mirror], [data-web-laas-msg-copy], #web-laas-msg-style").forEach((el) => el.remove());
  document.querySelectorAll("[data-web-laas-msg]").forEach((el) => el.removeAttribute("data-web-laas-msg"));
  const preview = new LivePreview(document);
  // the main-world script reads CodeMirror's undrawn lines for us (events cross worlds synchronously)
  const undrawn = (root: Element, comments: boolean): string[] | null => {
    let reply: string | null = null;
    const onReply = (e: Event) => (reply = (e as CustomEvent<string>).detail);
    root.addEventListener("web-laas:undrawn-reply", onReply);
    root.dispatchEvent(new CustomEvent("web-laas:undrawn", { bubbles: true, composed: true, detail: comments ? "comments" : "" }));
    root.removeEventListener("web-laas:undrawn-reply", onReply);
    try {
      return reply ? (JSON.parse(reply) as string[]) : null;
    } catch {
      return null;
    }
  };
  const rendered = new InlineRender(document, { undrawn, alive });
  // sent messages on chat sites, which show them as plain text
  const msgSelector = messageSelector(location.hostname);
  const messages = msgSelector ? new MessageRender(document, msgSelector) : null;
  document.addEventListener(HANDOVER_EVENT, () => {
    document.removeEventListener("web-laas:cm5-fill", fillCm5);
    rendered.destroy();
    messages?.destroy();
    preview.destroy();
  });
  let mode: PreviewMode | "off" = "above";

  const apply = async () => {
    const { prefs, enabled, disabledHosts, configText } = await loadState();
    if (!alive()) {
      messages?.destroy();
      return rendered.destroy();
    }
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
    messages?.set(on && prefs.inlineRender);
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
  // CodeMirror 5 editors (HackMD) typeset formulas themselves (content/cm5-math.ts, main world):
  // they leave empty spans for us to fill
  const cm5Style = document.createElement("style");
  cm5Style.dataset.webLaasRender = "";
  cm5Style.textContent = `${MATH_CSS.replace(/^mjx-container/gm, ".web-laas-math mjx-container")}
.web-laas-math { cursor: text; border-radius: 3px; }
.web-laas-math:hover { background: rgba(127,127,127,.12); }
.web-laas-display { display: inline-block; width: 100%; text-align: center; }`;
  (document.head ?? document.documentElement).append(cm5Style);
  const fillCm5 = () => {
    if (!alive()) return;
    for (const span of document.querySelectorAll<HTMLElement>("span[data-web-laas-math]:not([data-web-laas-filled])")) {
      // (an environment's body as MathJax takes it: align* → aligned…)
      const latex = prepareLatex({ latex: span.dataset.webLaasMath ?? "", caret: 0, env: span.dataset.env }, "").plain;
      const math = renderMathElement(latex, span.dataset.display !== undefined);
      span.dataset.webLaasFilled = "";
      if (math) span.replaceChildren(math);
      span.dispatchEvent(new CustomEvent("web-laas:cm5-filled", { bubbles: true, detail: math ? "" : "error" }));
    }
  };
  document.addEventListener("web-laas:cm5-fill", fillCm5);
  fillCm5();

  // ask the main-world engine for the formula we may have missed while loading
  document.dispatchEvent(new CustomEvent("web-laas:preview-ready"));
}
