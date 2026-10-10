// Opens the in-page cheat sheet overlay on a plain page (no extension APIs).
import { cheatsheetEntries, compileConfig, groupCheatsheet, snippetsForHost } from "web-laas-engine";
import { toggleCheatsheet } from "../../../src/cheatsheet/overlay";

const groups = groupCheatsheet(cheatsheetEntries(snippetsForHost(compileConfig(null).config, location.hostname)));
const open = () => toggleCheatsheet(groups, { host: location.hostname, shortcut: "Alt+Shift+K" });
(window as any).toggleCheatsheet = open;
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && e.code === "KeyK") open();
});
// ?open shows it right away (for screenshots)
if (new URLSearchParams(location.search).has("open")) open();

// ?toast shows the shortcut notification
import { showToast } from "../../../src/content/toast";
if (new URLSearchParams(location.search).has("toast")) showToast("LaTeX 自動展開已暫停", "off", "Alt+Shift+L 切換");
