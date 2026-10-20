import { compileConfig, hostMatches } from "web-laas-engine";
import {
  loadState,
  saveState,
  type BackgroundMessage,
  type CommandName,
  type ContentMessage,
  type Tone,
} from "./shared/storage";

const COMMANDS: CommandName[] = ["toggle-enabled", "toggle-cheatsheet"];
/** Keys handled by the in-page fallback when Chrome left a command unassigned. */
const FALLBACK_KEYS: Record<CommandName, string> = {
  "toggle-enabled": "Alt+Shift+L",
  "toggle-cheatsheet": "Alt+Shift+K",
};

async function assignedShortcuts(): Promise<Partial<Record<CommandName, string>>> {
  // chrome.commands is missing if a browser/build has no "commands" support
  const all = (await chrome.commands?.getAll().catch(() => [])) ?? [];
  return Object.fromEntries(all.filter((c) => c.shortcut).map((c) => [c.name, c.shortcut]));
}


async function shortcutLabel(command: CommandName): Promise<string> {
  return (await assignedShortcuts())[command] ?? FALLBACK_KEYS[command];
}

/** Is the engine on for the frame at `url` (not paused, not off by the toolbar or the config's disabledSites)? */
async function previewWanted(url: string | undefined): Promise<boolean> {
  const { enabled, disabledHosts, configText } = await loadState();
  if (!enabled) return false;
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {}
  let disabledSites: string[] = [];
  try {
    disabledSites = compileConfig(configText).config?.disabledSites ?? [];
  } catch {}
  return ![...disabledHosts, ...disabledSites].some((p) => hostMatches(host, p));
}

// ── icon / badge ────────────────────────────────────────────────────────
async function updateIcon() {
  const { enabled } = await loadState();
  const v = enabled ? "on" : "off";
  await chrome.action.setIcon({ path: { 16: `icons/${v}-16.png`, 32: `icons/${v}-32.png` } });
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: "#8e8e93" });
  await chrome.action.setTitle({ title: enabled ? "web-laas: on" : "web-laas: paused" });
}

// ── content scripts ─────────────────────────────────────────────────────
function send(tabId: number, msg: ContentMessage) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
}

/** Make sure the tab has a live content script (tabs opened before a reload don't). */
async function ensureContent(tabId: number): Promise<boolean> {
  try {
    if (await send(tabId, { type: "ping" })) return true;
  } catch {}
  try {
    const target = { tabId, allFrames: true };
    await chrome.scripting.executeScript({ target, files: ["content-main.js"], world: "MAIN", injectImmediately: true });
    await chrome.scripting.executeScript({ target, files: ["content-isolated.js"], injectImmediately: true });
    return true;
  } catch {
    return false; // chrome://, the Web Store, PDF viewer…
  }
}

/** In-page toast, or a system notification where pages can't be scripted. */
async function notify(tabId: number | undefined, text: string, tone: Tone, hint?: string) {
  if (tabId !== undefined && (await ensureContent(tabId))) {
    try {
      await send(tabId, { type: "toast", text, tone, hint });
      return;
    } catch {}
  }
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL(`icons/${tone === "off" ? "off" : "on"}-128.png`),
    title: "web-laas",
    message: hint ? `${text}\n${hint}` : text,
    priority: 0,
  });
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}

// ── commands ────────────────────────────────────────────────────────────
/** A command can arrive twice (browser shortcut + in-page listener); run it once. */
const lastRun = new Map<CommandName, number>();

async function runCommand(command: CommandName, tab?: chrome.tabs.Tab) {
  const now = Date.now();
  if (now - (lastRun.get(command) ?? 0) < 400) return;
  lastRun.set(command, now);
  tab ??= await activeTab();
  const tabId = tab?.id;
  const state = await loadState();

  if (command === "toggle-enabled") {
    const enabled = !state.enabled;
    await saveState({ enabled });
    let host = "";
    try {
      host = tab?.url ? new URL(tab.url).hostname : "";
    } catch {}
    const siteOff = enabled && host && state.disabledHosts.some((p) => hostMatches(host, p));
    const key = await shortcutLabel(command);
    await notify(
      tabId,
      enabled ? "LaTeX auto-expand is on" : "LaTeX auto-expand is paused",
      enabled ? "on" : "off",
      siteOff ? "but it is off for this site" : `${key} to switch`,
    );
    return;
  }

  if (!state.prefs.cheatsheet) {
    await notify(tabId, "The cheat sheet is turned off", "info", "Turn it on in the extension's settings");
    return;
  }
  const loaded =
    tabId !== undefined &&
    (await ensureContent(tabId)) &&
    (await chrome.scripting
      .executeScript({ target: { tabId, frameIds: [0] }, files: ["cheatsheet.js"], injectImmediately: true })
      .then(() => true)
      .catch(() => false));
  if (!loaded) {
    await notify(undefined, "The cheat sheet can't open on this page", "info", "Extensions aren't allowed on chrome:// pages and the like");
    return;
  }
  await send(tabId, { type: "toggle-cheatsheet", shortcut: await shortcutLabel(command) }).catch(() => {});
}

chrome.commands?.onCommand.addListener((command, tab) => {
  if ((COMMANDS as string[]).includes(command)) void runCommand(command as CommandName, tab);
});

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, reply) => {
  if (msg?.type === "run-command") void runCommand(msg.command, sender.tab);
  else if (msg?.type === "open-cheatsheet") {
    void (async () => {
      const tab = msg.tabId !== undefined ? await chrome.tabs.get(msg.tabId).catch(() => undefined) : undefined;
      await runCommand("toggle-cheatsheet", tab);
    })();
  } else if (msg?.type === "load-preview") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    void (async () => {
      // not where the engine is off (the preview would stay idle): replies whether it's loading
      if (!(await previewWanted(sender.url))) return reply(false);
      reply(true);
      await chrome.scripting
        .executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, files: ["preview.js"], injectImmediately: true })
        .catch(() => {});
    })();
    return true; // async reply
  } else if (msg?.type === "load-composer") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    void (async () => {
      if (!(await previewWanted(sender.url))) return reply(false);
      const frameIds = [sender.frameId ?? 0];
      const loaded = await chrome.scripting.executeScript({ target: { tabId, frameIds }, files: ["composer.js"], injectImmediately: true })
        .then(() => true, () => false);
      reply(loaded);
    })();
    return true; // async reply
  } else if (msg?.type === "shortcuts") {
    void assignedShortcuts().then(reply);
    return true; // async reply
  }
});

// ── lifecycle ───────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) void updateIcon();
});
chrome.runtime.onStartup.addListener(() => void updateIcon());
chrome.runtime.onInstalled.addListener(async () => {
  await updateIcon();
  // Bring already-open tabs up to date without a manual refresh.
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  await Promise.all(tabs.map((t) => (t.id !== undefined ? ensureContent(t.id) : null)));
});
