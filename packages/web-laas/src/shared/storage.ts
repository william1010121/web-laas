import { DEFAULT_PREFS, type LaasPrefs, type RuntimeState } from "web-laas-engine/dom";
import { hostMatches, type MathDelimiters } from "web-laas-engine";

/** Engine prefs plus extension-only switches. */
export type PreviewPref = "above" | "below" | "corner" | "off";

export interface ExtensionPrefs extends LaasPrefs {
  /** Alt+Shift+K opens the in-page cheat sheet */
  cheatsheet: boolean;
  /** live LaTeX preview: floating above / below the caret, in the corner, or off */
  preview: PreviewPref;
  /** formulas the caret isn't in are shown rendered, over their source */
  inlineRender: boolean;
  /** experimental: our own editor in place of the message box on `composerSites` */
  composer: boolean;
  composerSites: string[];
  /** the composer: Vim keys */
  composerVim: boolean;
  /** the composer: only ⌘Enter / Ctrl+Enter sends, Enter starts a new line */
  composerModEnter: boolean;
  /** the composer with Vim keys: the live preview in normal mode too (else in insert mode only) */
  composerVimPreview: boolean;
  /** the composer: how opaque the site's message box is while our editor is in it (0.2–1), to read the chat behind a long message */
  composerOpacity: number;
}

export const DEFAULT_EXTENSION_PREFS: ExtensionPrefs = {
  ...DEFAULT_PREFS,
  cheatsheet: true,
  preview: "above",
  inlineRender: true,
  composer: false,
  composerSites: ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com"],
  composerVim: false,
  composerModEnter: false,
  composerVimPreview: false,
  composerOpacity: 1,
};

/** A snippet made in the cheat sheet (the same fields as one in the config). */
export interface SnippetSpec {
  trigger: string;
  replacement: string;
  options?: string;
  math?: "inline" | "display";
  sites?: string[];
  group?: string;
}

/** The cheat sheet group of the snippets made there. */
export const ADDED_GROUP = "Added in the cheat sheet";

export interface StoredState extends RuntimeState {
  prefs: ExtensionPrefs;
  /** mk / dm delimiters per host, set from the popup */
  siteMath: Record<string, MathDelimiters>;
  /** snippets made in the cheat sheet (kept apart from the config text, which is yours to format) */
  snippets: SnippetSpec[];
}

export const STORAGE_KEYS = ["configText", "enabled", "disabledHosts", "prefs", "siteMath", "snippets"] as const;

export async function loadState(): Promise<StoredState> {
  const v = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    configText: typeof v.configText === "string" ? v.configText : null,
    enabled: v.enabled !== false,
    disabledHosts: Array.isArray(v.disabledHosts) ? v.disabledHosts : [],
    siteMath: v.siteMath && typeof v.siteMath === "object" ? (v.siteMath as Record<string, MathDelimiters>) : {},
    snippets: Array.isArray(v.snippets) ? (v.snippets as SnippetSpec[]) : [],
    prefs: { ...DEFAULT_EXTENSION_PREFS, ...(v.prefs && typeof v.prefs === "object" ? v.prefs : {}) },
  };
}

/** The part of the state a page on `host` needs: other sites' entries left out. */
export function stateForSite(state: StoredState, host: string): StoredState {
  return {
    ...state,
    disabledHosts: state.disabledHosts.filter((p) => hostMatches(host, p)),
    siteMath: Object.fromEntries(Object.entries(state.siteMath).filter(([p]) => hostMatches(host, p))),
    prefs: { ...state.prefs, composerSites: state.prefs.composerSites.filter((p) => hostMatches(host, p)) },
    snippets: state.snippets.filter((s) => !s.sites || s.sites.some((p) => hostMatches(host, p))),
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
  | { type: "load-preview" }
  | { type: "load-composer" };

export type Tone = "on" | "off" | "info";
export type CommandName = "toggle-enabled" | "toggle-cheatsheet";
