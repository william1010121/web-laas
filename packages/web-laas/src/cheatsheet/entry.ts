// cheatsheet.js: injected into the top frame by the background only when the
// cheat sheet is opened, so KaTeX isn't loaded into every page and iframe.
import { cheatsheetEntries, compileConfig, groupCheatsheet, snippetsForHost } from "web-laas-engine";
import { alive } from "../shared/alive";
import { loadState, type ContentMessage } from "../shared/storage";
import { toggleCheatsheet } from "./overlay";

declare global {
  interface Window {
    __webLaasCheatsheetAlive?: () => boolean;
  }
}

async function open(shortcut?: string) {
  const state = await loadState();
  let config;
  try {
    config = compileConfig(state.configText, { extras: state.prefs.extras, cdlatex: state.prefs.cdlatex }).config;
  } catch {
    config = compileConfig(null, { extras: state.prefs.extras, cdlatex: state.prefs.cdlatex }).config;
  }
  const host = location.hostname;
  const groups = groupCheatsheet(cheatsheetEntries(snippetsForHost(config, host)));
  toggleCheatsheet(groups, { host, shortcut });
}

if (!window.__webLaasCheatsheetAlive?.()) {
  window.__webLaasCheatsheetAlive = alive;
  chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
    if (msg?.type === "toggle-cheatsheet") void open(msg.shortcut);
  });
}
