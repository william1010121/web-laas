// Isolated-world bridge: reads settings from chrome.storage and forwards them
// to the main-world script as a JSON string (objects don't cross worlds).
// The top frame also shows shortcut toasts. (The cheat sheet lives in
// cheatsheet.js, injected on demand, to keep KaTeX out of every frame.)
import { alive } from "../shared/alive";
import { matchesChord, parseShortcut, type Chord } from "../shared/shortcut";
import {
  loadState,
  STORAGE_KEYS,
  type BackgroundMessage,
  type CommandName,
  type ContentMessage,
} from "../shared/storage";
import { showToast } from "./toast";

declare global {
  interface Window {
    __webLaasIsolatedAlive?: () => boolean;
  }
}

// The background re-injects this script into tabs that were open before the
// extension was (re)loaded; skip if a live copy is already here.
if (!window.__webLaasIsolatedAlive?.()) {
  window.__webLaasIsolatedAlive = alive;
  start();
}

function start() {
  async function send() {
    const state = await loadState();
    document.dispatchEvent(new CustomEvent("web-laas:state", { detail: JSON.stringify(state) }));
  }
  // A main-world script from a build before the versioned hand-over can't be
  // replaced; switch it off through its old event so it doesn't keep running.
  document.dispatchEvent(new CustomEvent("laasweb:state", { detail: JSON.stringify({ enabled: false }) }));

  document.addEventListener("web-laas:ready", () => alive() && void send());

  // The first time the caret is in math here, load the live preview into this frame.
  let previewRequested = false;
  document.addEventListener("web-laas:formula", (e) => {
    if (previewRequested || !alive() || (e as CustomEvent<string>).detail === "null") return;
    previewRequested = true;
    chrome.runtime.sendMessage({ type: "load-preview" } satisfies BackgroundMessage).catch(() => (previewRequested = false));
  });
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
