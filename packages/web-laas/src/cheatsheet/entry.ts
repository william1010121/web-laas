// cheatsheet.js: injected into the top frame by the background only when the
// cheat sheet is opened, so MathJax isn't loaded into every page and iframe.
import { cheatsheetEntries, compileConfig, groupCheatsheet, snippetsForHost, withMathDelimiters, resolveMathDelimiters, type CheatsheetEntry } from "web-laas-engine";
import { alive } from "../shared/alive";
import { ADDED_GROUP, loadState, saveState, type ContentMessage, type StoredState } from "../shared/storage";
import { refreshCheatsheet, toggleCheatsheet } from "./overlay";
import type { NewSnippet } from "./sheet";

declare global {
  interface Window {
    __webLaasCheatsheetAlive?: () => boolean;
  }
}

function groupsFor(state: StoredState) {
  const opts = { extras: state.prefs.extras, cdlatex: state.prefs.cdlatex, snippets: state.snippets };
  let config;
  try {
    config = compileConfig(state.configText, opts).config;
  } catch {
    config = compileConfig(null, opts).config;
  }
  const host = location.hostname;
  return groupCheatsheet(cheatsheetEntries(withMathDelimiters(snippetsForHost(config, host), resolveMathDelimiters(state.siteMath, host), host)));
}

/** A snippet made in the cheat sheet: checked like one in the config, then saved. */
async function add(spec: NewSnippet): Promise<string | null> {
  const state = await loadState();
  const snippet = { ...spec, group: ADDED_GROUP };
  const { issues } = compileConfig(null, { snippets: [snippet] });
  if (issues.length) return issues.map((i) => i.message.replace(/^added snippets\[\d+\]: /, "")).join("; ");
  // the same trigger again (for the same sites): the new one replaces it
  const same = (s: typeof snippet) => s.trigger === spec.trigger && String(s.sites) === String(spec.sites);
  await saveState({ snippets: [...state.snippets.filter((s) => !same(s as typeof snippet)), snippet] });
  refreshCheatsheet(groupsFor(await loadState()));
  return null;
}

const deletable = (e: CheatsheetEntry) => e.source === "user" && e.group === ADDED_GROUP;

async function remove(e: CheatsheetEntry) {
  const state = await loadState();
  const i = state.snippets.findIndex((s) => s.trigger === e.trigger && s.replacement === e.code);
  if (i < 0) return;
  await saveState({ snippets: state.snippets.filter((_, k) => k !== i) });
  refreshCheatsheet(groupsFor(await loadState()));
}

async function open(shortcut?: string) {
  const state = await loadState();
  toggleCheatsheet(groupsFor(state), { host: location.hostname, shortcut, onAdd: add, deletable, onDelete: remove });
}

if (!window.__webLaasCheatsheetAlive?.()) {
  window.__webLaasCheatsheetAlive = alive;
  chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
    if (msg?.type === "toggle-cheatsheet") void open(msg.shortcut);
  });
}
