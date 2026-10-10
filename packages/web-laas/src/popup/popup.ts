import { loadState, saveState } from "../shared/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    const url = tab?.url ? new URL(tab.url) : null;
    if (url && /^https?:|^file:/.test(url.protocol)) host = url.hostname || url.protocol;
  } catch {}
  const state = await loadState();
  const enabled = $<HTMLInputElement>("enabled");
  const site = $<HTMLInputElement>("site");
  const sync = () => {
    document.body.classList.toggle("off", !enabled.checked);
    $("sub").textContent = enabled.checked ? "自動展開已啟用" : "自動展開已暫停";
  };
  enabled.checked = state.enabled;
  site.checked = !state.disabledHosts.includes(host);
  site.disabled = !host;
  $("host").textContent = host || "此頁面無法使用（chrome:// 等）";
  sync();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ready")));

  const commands = await chrome.commands.getAll();
  const cs = commands.find((c) => c.name === "toggle-cheatsheet")?.shortcut;
  $("csKey").textContent = cs || "Alt+Shift+K"; // unassigned → in-page fallback key
  const cheat = $<HTMLButtonElement>("cheatsheet");
  cheat.disabled = !host || !state.prefs.cheatsheet;
  if (!state.prefs.cheatsheet) cheat.title = "已在設定中關閉";

  enabled.onchange = async () => {
    await saveState({ enabled: enabled.checked });
    sync();
  };
  site.onchange = async () => {
    const { disabledHosts } = await loadState();
    const next = disabledHosts.filter((h) => h !== host);
    if (!site.checked) next.push(host);
    await saveState({ disabledHosts: next });
  };
  cheat.onclick = async () => {
    await chrome.runtime.sendMessage({ type: "open-cheatsheet", tabId: tab?.id });
    window.close();
  };
  $("options").onclick = () => chrome.runtime.openOptionsPage();
}
void main();
