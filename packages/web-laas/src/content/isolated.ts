// Isolated-world bridge: reads settings from chrome.storage and forwards them
// to the main-world script as a JSON string (objects don't cross worlds).
// The top frame also shows shortcut toasts. (The cheat sheet lives in
// cheatsheet.js, injected on demand, to keep MathJax out of every frame.)
import { alive } from "../shared/alive";
import { matchesChord, parseShortcut, type Chord } from "../shared/shortcut";
import {
  loadState,
  stateForSite,
  STORAGE_KEYS,
  type BackgroundMessage,
  type CommandName,
  type ContentMessage,
} from "../shared/storage";
import { messageSelector } from "../shared/chat";
import { showToast } from "./toast";

declare global {
  interface Window {
    __webLaasIsolatedAlive?: () => boolean;
    __webLaasComposerKey?: (e: KeyboardEvent) => boolean;
  }
}

// The background re-injects this script into tabs that were open before the
// extension was (re)loaded; skip if a live copy is already here.
/** Shadow roots whose scrolling also triggers a look for math (see onScroll). */
const watchedShadows = new WeakSet<ShadowRoot>();
let onScroll = () => {};

const MATH_HINT = /\$|\\[([]|\\begin\s*\{/;

/** Does any editor on the page contain something that looks like math? */
function editorsHaveMath(): boolean {
  // formulas a CodeMirror 5 editor already took out of its text, waiting for preview.js to draw them
  if (document.querySelector("span[data-web-laas-math]:not([data-web-laas-filled])")) return true;
  const editors = ".cm-content, .CodeMirror-code, textarea, input[type=text], input[type=search], input:not([type]), [contenteditable]";
  // (editors in open shadow roots too)
  const scopes: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < scopes.length; i++) {
    for (const el of scopes[i].querySelectorAll("*")) if (el.shadowRoot) scopes.push(el.shadowRoot);
  }
  // scrolling inside a shadow root doesn't reach the document's listener
  for (const sc of scopes) if (sc instanceof ShadowRoot && !watchedShadows.has(sc)) {
    watchedShadows.add(sc);
    sc.addEventListener("scroll", () => onScroll(), { capture: true, passive: true });
  }
  for (const el of scopes.flatMap((sc) => [...sc.querySelectorAll<HTMLElement>(editors)])) {
    const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
    const text = field ? el.value : el.isContentEditable || el.classList.contains("CodeMirror-code") ? el.textContent : "";
    if (text && MATH_HINT.test(text)) return true;
  }
  // messages already sent on a chat site (ChatGPT, Claude, Gemini show them as plain text)
  const sent = messageSelector(location.hostname);
  if (sent) for (const el of document.querySelectorAll(sent)) if (MATH_HINT.test(el.textContent ?? "")) return true;
  return false;
}

if (!window.__webLaasIsolatedAlive?.()) {
  window.__webLaasIsolatedAlive = alive;
  // Esc and Enter in the composer (composer.js, loaded later) go to it before any of the page's
  // own listeners: this one is added at document_start, ahead of them (Claude catches both)
  window.addEventListener(
    "keydown",
    (e) => {
      if (window.__webLaasComposerKey?.(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  start();
}

function start() {
  // a fresh start means the previous build's scripts are dead: take down a card it left on screen
  // (the new preview.js only arrives once a formula shows up, which may be never)
  document.querySelectorAll("[data-web-laas-preview]").forEach((el) => el.remove());
  let composerRequested = false;
  async function send() {
    const state = await loadState();
    renderWanted = state.enabled && state.prefs.inlineRender;
    siteOff = false; // the settings changed: ask again
    if (renderWanted) checkForMath();
    // The main-world script gets this through a page event, which the page's own scripts can
    // hear too: send only what this site needs, not the settings of every other site
    const forThisSite = stateForSite(state, location.hostname);
    document.dispatchEvent(new CustomEvent("web-laas:state", { detail: JSON.stringify(forThisSite) }));
    // the experimental composer, on the sites it's set for (it removes itself when turned off)
    // (in frames too: ChatSprig shows Gemini in a frame on other pages)
    if (!composerRequested && forThisSite.enabled && forThisSite.prefs.composer && forThisSite.prefs.composerSites.length) {
      composerRequested = true;
      void chrome.runtime.sendMessage({ type: "load-composer" } satisfies BackgroundMessage)
        .then((loading: unknown) => { if (loading === false) composerRequested = false; })
        .catch(() => (composerRequested = false));
    }
  }
  // A main-world script from a build before the versioned hand-over can't be
  // replaced; switch it off through its old event so it doesn't keep running.
  document.dispatchEvent(new CustomEvent("laasweb:state", { detail: JSON.stringify({ enabled: false }) }));

  document.addEventListener("web-laas:ready", () => alive() && void send());

  // The first time the caret is in math here, load the live preview into this frame.
  let previewRequested = false;
  // the engine is off on this site (the background said so): no looking for math until the settings change
  let siteOff = false;
  const loadPreview = () => {
    if (previewRequested || siteOff || !alive()) return;
    previewRequested = true;
    chrome.runtime
      .sendMessage({ type: "load-preview" } satisfies BackgroundMessage)
      .then((loading: unknown) => {
        if (loading !== false) return;
        previewRequested = false;
        siteOff = true;
      })
      .catch(() => (previewRequested = false));
  };
  document.addEventListener("web-laas:formula", (e) => {
    if ((e as CustomEvent<string>).detail !== "null") loadPreview();
  });
  // Rendering formulas in place needs it too, as soon as an editor holds math.
  let renderWanted = false;
  let checkTimer = 0;
  const checkForMath = () => {
    if (!renderWanted || siteOff || previewRequested) return;
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => {
      if (renderWanted && !previewRequested && editorsHaveMath()) loadPreview();
    }, 300);
  };
  document.addEventListener("focusin", checkForMath, true);
  // typing changes only the editor typed in: look at its text, not the whole page (a long chat)
  document.addEventListener(
    "input",
    (e) => {
      if (!renderWanted || siteOff || previewRequested) return;
      const t = e.composedPath()[0];
      const el = t instanceof Element ? t : null;
      const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
      const text = field ? field.value : (el?.closest(".cm-content, .CodeMirror-code") ?? (el as HTMLElement | null))?.textContent;
      if (text && MATH_HINT.test(text)) checkForMath();
    },
    true,
  );
  // CodeMirror only has the lines near the window in the page: math further down shows up on scrolling
  onScroll = () => !previewRequested && checkForMath();
  document.addEventListener("scroll", () => onScroll(), { capture: true, passive: true });
  // editors in web apps show up (and fill) a while after the page loads
  let checks = 0;
  const poll = window.setInterval(() => (previewRequested || ++checks > 20 ? clearInterval(poll) : checkForMath()), 3000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => (STORAGE_KEYS as readonly string[]).includes(k))) void send();
  });
  void send();

  if (window !== window.top) return;

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, reply) => {
    if (msg?.type === "ping") reply(true);
    else if (msg?.type === "toast") showToast(msg.text, msg.tone, msg.hint);
  });

  // In-page shortcuts. Some browsers (Arc) don't deliver extension commands,
  // and Chrome only assigns suggested keys on first install, so we also listen
  // here — for the defaults and for whatever the browser has assigned. When the
  // browser does handle a chord itself the page never sees it; the background
  // ignores a command repeated within a few hundred ms just in case.
  const DEFAULTS: [CommandName, string][] = [
    ["toggle-enabled", "Alt+Shift+L"],
    ["toggle-cheatsheet", "Alt+Shift+K"],
  ];
  let chords: [CommandName, Chord][] = [];
  const refresh = async () => {
    let assigned: Partial<Record<CommandName, string>> = {};
    try {
      assigned = (await chrome.runtime.sendMessage({ type: "shortcuts" } satisfies BackgroundMessage)) ?? {};
    } catch {}
    chords = [];
    for (const [command, def] of DEFAULTS) {
      for (const s of [def, assigned[command]]) {
        const c = parseShortcut(s);
        if (c) chords.push([command, c]);
      }
    }
  };
  void refresh();
  window.addEventListener("focus", () => alive() && void refresh());
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || !alive()) return;
      const hit = chords.find(([, c]) => matchesChord(e, c));
      if (!hit) return;
      e.preventDefault(); // Option+Shift+K would otherwise type "" on macOS
      e.stopImmediatePropagation();
      void chrome.runtime.sendMessage({ type: "run-command", command: hit[0] } satisfies BackgroundMessage);
    },
    true,
  );
}
