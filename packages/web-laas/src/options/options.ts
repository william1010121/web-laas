import { cheatsheetEntries, compileConfig, groupCheatsheet, snippetsForHost, withMathDelimiters, resolveMathDelimiters, type CompiledConfig } from "web-laas-engine";
import { LaasController } from "web-laas-engine/dom";
import { buildCheatsheet, SHEET_CSS } from "../cheatsheet/sheet";
import { loadState, savePrefs, saveState, type ExtensionPrefs, type PreviewPref, type StoredState } from "../shared/storage";
import TEMPLATE from "./template.laas";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = $<HTMLTextAreaElement>("config");
const status = $("status");
const playground = $<HTMLTextAreaElement>("playground");

let state: StoredState;
const controller = new LaasController({ host: "options.local", filter: (el) => el === playground });
controller.attach();

// ── toast ───────────────────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 1600);
}

// ── routing ─────────────────────────────────────────────────────────────
const PAGES = ["general", "snippets", "cheatsheet", "shortcuts", "sites", "about"];
function route() {
  const id = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "general";
  for (const p of PAGES) $(`page-${p}`).classList.toggle("active", p === id);
  document.querySelectorAll<HTMLAnchorElement>(".nav").forEach((a) => a.classList.toggle("active", a.hash === `#${id}`));
  if (id === "cheatsheet") renderSheet();
}
window.addEventListener("hashchange", route);

// ── config / validation ─────────────────────────────────────────────────
function compileCurrent(): { config: CompiledConfig | null; error: string | null } {
  try {
    const { config, issues } = compileConfig(editor.value, { extras: state.prefs.extras, cdlatex: state.prefs.cdlatex });
    return { config, error: issues.length ? issues.map((i) => i.message).join("\n") : null };
  } catch (e) {
    return { config: null, error: (e as Error).message };
  }
}

function validate(): boolean {
  const { config, error } = compileCurrent();
  controller.setState({ configText: editor.value, enabled: true, disabledHosts: [], prefs: state.prefs });
  if (error) {
    status.className = "status err";
    status.textContent = error;
    return false;
  }
  status.className = "status ok";
  const mine = config!.snippets.filter((s) => s.source === "user").length;
  status.textContent = `✓ ${mine} of mine · ${config!.snippets.length} snippets in all`;
  return true;
}

async function save() {
  if (!validate()) return toast("The config has errors; not saved");
  await saveState({ configText: editor.value });
  state.configText = editor.value;
  sheetDirty = true;
  toast("Saved");
}

// ── cheat sheet ─────────────────────────────────────────────────────────
let sheetDirty = true;
function renderSheet() {
  if (!sheetDirty) return;
  sheetDirty = false;
  const { config } = compileCurrent();
  const cfg = config ?? compileConfig(null, { extras: state.prefs.extras, cdlatex: state.prefs.cdlatex }).config;
  const select = $<HTMLSelectElement>("sheetSite");
  const groups = groupCheatsheet(cheatsheetEntries(
    withMathDelimiters(snippetsForHost(cfg, select.value), resolveMathDelimiters(state.siteMath, select.value)),
  ));
  const label = select.selectedOptions[0]?.textContent ?? "";
  $("sheetHost").replaceChildren(buildCheatsheet(document, groups, { host: label }));
}

// ── general ─────────────────────────────────────────────────────────────
function renderMaster() {
  $("masterState").textContent = state.enabled ? "On · Alt+Shift+L" : "Paused · Alt+Shift+L";
}

type BoolPref = { [K in keyof ExtensionPrefs]: ExtensionPrefs[K] extends boolean ? K : never }[keyof ExtensionPrefs];

function bindPrefs() {
  document.querySelectorAll<HTMLInputElement>('input[name="preview"]').forEach((radio) => {
    radio.checked = radio.value === state.prefs.preview;
    radio.onchange = async () => {
      if (!radio.checked) return;
      const preview = radio.value as PreviewPref;
      state.prefs = { ...state.prefs, preview };
      await savePrefs({ preview });
      toast("Saved");
    };
  });
  document.querySelectorAll<HTMLInputElement>("input[data-pref]").forEach((input) => {
    const key = input.dataset.pref as BoolPref;
    input.checked = state.prefs[key];
    input.onchange = async () => {
      state.prefs = { ...state.prefs, [key]: input.checked };
      await savePrefs({ [key]: input.checked });
      controller.setState({ prefs: state.prefs });
      sheetDirty = true;
      if (key === "extras" || key === "cdlatex") validate();
      toast("Saved");
    };
  });
  const builtins = compileConfig(null).config.snippets;
  $("laasCount").textContent = String(builtins.filter((s) => s.source === "laas").length);
  $("extrasCount").textContent = String(builtins.filter((s) => s.source === "extras").length);
  $("cdlatexCount").textContent = String(builtins.filter((s) => s.source === "cdlatex").length);
}

// ── shortcuts ───────────────────────────────────────────────────────────
const FALLBACK_KEYS: Record<string, string> = { "toggle-enabled": "Alt+Shift+L", "toggle-cheatsheet": "Alt+Shift+K" };
async function renderShortcuts() {
  const list = $("commands");
  const commands = await chrome.commands.getAll();
  list.replaceChildren(
    ...commands
      .filter((c) => c.name !== "_execute_action")
      .map((c) => {
        const row = document.createElement("div");
        row.className = "row";
        const text = document.createElement("div");
        text.className = "text";
        text.innerHTML = `<div class="title"></div>`;
        text.firstElementChild!.textContent = c.description ?? c.name ?? "";
        const fallback = FALLBACK_KEYS[c.name ?? ""];
        const key = document.createElement("kbd");
        key.textContent = c.shortcut || fallback || "Not set";
        if (!c.shortcut) {
          const note = document.createElement("div");
          note.className = "desc warn";
          note.textContent = fallback
            ? `Chrome didn't assign this shortcut, so the page handles it for now (not on chrome:// pages and the like). Assign it in Chrome's settings.`
            : "Not assigned";
          text.append(note);
          $("shortcutWarn").hidden = false;
        }
        row.append(text, key);
        if (c.name === "toggle-cheatsheet") {
          document.querySelectorAll("#csKey, .csKey").forEach((k) => (k.textContent = c.shortcut || "Alt+Shift+K"));
        }
        return row;
      }),
  );
}

// ── sites ───────────────────────────────────────────────────────────────
function renderSites() {
  const list = $("siteList");
  list.replaceChildren(
    ...state.disabledHosts.map((h) => {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "text site-host";
      name.textContent = h;
      const rm = document.createElement("button");
      rm.className = "btn ghost";
      rm.textContent = "Remove";
      rm.onclick = async () => {
        state.disabledHosts = state.disabledHosts.filter((x) => x !== h);
        await saveState({ disabledHosts: state.disabledHosts });
        renderSites();
        toast(`On again on ${h}`);
      };
      row.append(name, rm);
      return row;
    }),
  );
}

async function main() {
  state = await loadState();
  editor.value = state.configText ?? TEMPLATE;
  $("version").textContent = "v" + chrome.runtime.getManifest().version;

  const style = document.createElement("style");
  style.textContent = SHEET_CSS;
  document.head.append(style);

  const enabled = $<HTMLInputElement>("enabled");
  enabled.checked = state.enabled;
  enabled.onchange = async () => {
    state.enabled = enabled.checked;
    await saveState({ enabled: enabled.checked });
    renderMaster();
    toast(enabled.checked ? "On" : "Paused");
  };
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      state.enabled = changes.enabled.newValue !== false;
      enabled.checked = state.enabled;
      renderMaster();
    }
    if (changes.disabledHosts) {
      state.disabledHosts = Array.isArray(changes.disabledHosts.newValue) ? changes.disabledHosts.newValue : [];
      renderSites();
    }
    if (changes.siteMath) {
      // the popup changed what mk / dm insert somewhere: the cheat sheet shows it
      state.siteMath = (changes.siteMath.newValue ?? {}) as StoredState["siteMath"];
      sheetDirty = true;
      if ($("page-cheatsheet").classList.contains("active")) renderSheet();
    }
  });
  renderMaster();
  bindPrefs();
  validate();
  renderSites();
  void renderShortcuts();
  route();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ready")));

  $("save").onclick = () => void save();
  $<HTMLSelectElement>("sheetSite").onchange = () => {
    sheetDirty = true;
    renderSheet();
  };
  $("reset").onclick = () => {
    if (confirm("Replace the current config with the template? (Not saved yet.)")) {
      editor.value = TEMPLATE;
      validate();
    }
  };
  $("toggleRef").onclick = (e) => {
    e.preventDefault();
    $("ref").hidden = !$("ref").hidden;
  };
  for (const id of ["editShortcuts", "fixShortcuts"]) $(id).onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  $<HTMLFormElement>("addSite").onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("siteInput");
    const host = input.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (!host) return;
    if (!state.disabledHosts.includes(host)) state.disabledHosts = [...state.disabledHosts, host];
    await saveState({ disabledHosts: state.disabledHosts });
    input.value = "";
    renderSites();
    toast(`Off on ${host}`);
  };
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      void save();
    }
  });
  // Tab inserts two spaces in the config editor.
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  });
  let timer = 0;
  editor.addEventListener("input", () => {
    clearTimeout(timer);
    sheetDirty = true;
    timer = window.setTimeout(validate, 400);
  });
}
void main();
