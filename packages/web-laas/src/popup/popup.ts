import { resolveMathDelimiters, type DisplayMathStyle, type InlineMathStyle, type MathDelimiters } from "web-laas-engine";
import { loadState, saveState } from "../shared/storage";

const INLINE: [InlineMathStyle, string, string][] = [
  ["auto", "預設", "依網站預設（$…$）"],
  ["dollar", "$…$", "$…$"],
  ["paren", "\\(…\\)", "\\(…\\)"],
];
const DISPLAY: [DisplayMathStyle, string, string][] = [
  ["auto", "預設", "依網站預設（Overleaf 用 \\[…\\]，其他用 $$…$$）"],
  ["ddollar", "$$", "$$…$$"],
  ["bracket", "\\[ \\]", "\\[…\\]"],
  ["equation", "equation*", "\\begin{equation*}…\\end{equation*}"],
  ["align", "align", "\\begin{align}…\\end{align}"],
];

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
  // any web host, localhost and intranet names included (file: pages have no host to key on)
  if (host && host !== "file:") setupDelims(host, resolveMathDelimiters(state.siteMath, host)); // inherited choices show too
  $("options").onclick = () => chrome.runtime.openOptionsPage();
}

/** The mk / dm segmented controls: one choice per kind, saved under this host. */
function setupDelims(host: string, current: MathDelimiters) {
  $("delims").hidden = false;
  const build = <K extends keyof MathDelimiters>(kind: K, options: [NonNullable<MathDelimiters[K]>, string, string][]) => {
    const seg = $(kind);
    const render = (value: string) =>
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
    for (const [value, label, title] of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = value;
      b.textContent = label;
      b.title = title;
      if (value === "auto") b.className = "auto";
      b.onclick = async () => {
        render(value);
        const { siteMath } = await loadState();
        // "auto" is stored too: it overrides a parent domain's choice
        await saveState({ siteMath: { ...siteMath, [host]: { ...siteMath[host], [kind]: value } } });
      };
      seg.appendChild(b);
    }
    render(current[kind] ?? "auto");
  };
  build("inline", INLINE);
  build("display", DISPLAY);
}

void main();
