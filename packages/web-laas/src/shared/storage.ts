import { DEFAULT_PREFS, type LaasPrefs, type RuntimeState } from "web-laas-engine/dom";

/** Engine prefs plus extension-only switches. */
export type PreviewPref = "above" | "below" | "corner" | "off";

export interface ExtensionPrefs extends LaasPrefs {
  /** Alt+Shift+K opens the in-page cheat sheet */
  cheatsheet: boolean;
  /** live LaTeX preview: floating above / below the caret, in the corner, or off */
  preview: PreviewPref;
}

export const DEFAULT_EXTENSION_PREFS: ExtensionPrefs = { ...DEFAULT_PREFS, cheatsheet: true, preview: "above" };

export interface StoredState extends RuntimeState {
  prefs: ExtensionPrefs;
}

export const STORAGE_KEYS = ["configText", "enabled", "disabledHosts", "prefs"] as const;

export async function loadState(): Promise<StoredState> {
  const v = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    configText: typeof v.configText === "string" ? v.configText : null,
    enabled: v.enabled !== false,
    disabledHosts: Array.isArray(v.disabledHosts) ? v.disabledHosts : [],
    prefs: { ...DEFAULT_EXTENSION_PREFS, ...(v.prefs && typeof v.prefs === "object" ? v.prefs : {}) },
  };
}

export async function saveState(patch: Partial<StoredState>) {
  await chrome.storage.local.set(patch);
}

export async function savePrefs(patch: Partial<ExtensionPrefs>) {
  const { prefs } = await loadState();
  await saveState({ prefs: { ...prefs, ...patch } });
}

/** Messages from the background to content scripts. */
export type ContentMessage =
  | { type: "ping" }
  | { type: "toggle-cheatsheet"; shortcut?: string }
  | { type: "toast"; text: string; tone: Tone; hint?: string };

/** Messages from content scripts / popup to the background. */
export type BackgroundMessage =
  | { type: "run-command"; command: CommandName }
  | { type: "open-cheatsheet"; tabId?: number }
  | { type: "shortcuts" }
  | { type: "load-preview" };

export type Tone = "on" | "off" | "info";
export type CommandName = "toggle-enabled" | "toggle-cheatsheet";
