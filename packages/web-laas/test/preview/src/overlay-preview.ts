// Opens the in-page cheat sheet overlay on a plain page (no extension APIs).
import { cheatsheetEntries, compileConfig, groupCheatsheet, snippetsForHost, withMathDelimiters, type CheatsheetEntry } from "web-laas-engine";
import { refreshCheatsheet, toggleCheatsheet } from "../../../src/cheatsheet/overlay";
import type { NewSnippet } from "../../../src/cheatsheet/sheet";

// snippets made in the cheat sheet, in memory here (the extension keeps them in chrome.storage)
const GROUP = "Added in the cheat sheet";
let added: (NewSnippet & { group: string })[] = [];
const groups = () =>
  groupCheatsheet(cheatsheetEntries(withMathDelimiters(snippetsForHost(compileConfig(null, { snippets: added }).config, location.hostname), undefined, location.hostname)));
const onAdd = async (spec: NewSnippet) => {
  const { issues } = compileConfig(null, { snippets: [spec] });
  if (issues.length) return issues[0].message;
  added = [...added.filter((s) => s.trigger !== spec.trigger), { ...spec, group: GROUP }];
  refreshCheatsheet(groups());
  return null;
};
const deletable = (e: CheatsheetEntry) => e.source === "user" && e.group === GROUP;
const onDelete = async (e: CheatsheetEntry) => {
  added = added.filter((s) => s.trigger !== e.trigger);
  refreshCheatsheet(groups());
};
const open = () => toggleCheatsheet(groups(), { host: location.hostname, shortcut: "Alt+Shift+K", onAdd, deletable, onDelete });
(window as any).toggleCheatsheet = open;
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && e.code === "KeyK") open();
});
// ?open shows it right away (for screenshots)
if (new URLSearchParams(location.search).has("open")) open();

// ?toast shows the shortcut notification
import { showToast } from "../../../src/content/toast";
if (new URLSearchParams(location.search).has("toast")) showToast("LaTeX auto-expand is paused", "off", "Alt+Shift+L to switch");
