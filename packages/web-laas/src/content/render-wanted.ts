import { hostMatches, parseConfigText } from "web-laas-engine";
import type { StoredState } from "../shared/storage";

/** Gate discovery too, not only the eventual background injection. Parsing the
 * user config avoids loading/compiling all built-in snippets in this bridge. */
export function renderWantedOnSite(state: StoredState, host: string): boolean {
  if (!state.enabled || !state.prefs.inlineRender || state.disabledHosts.some((pattern) => hostMatches(host, pattern))) return false;
  try {
    const config = state.configText ? parseConfigText(state.configText) as { disabledSites?: unknown } : null;
    if (Array.isArray(config?.disabledSites) && config.disabledSites.some((pattern) => typeof pattern === "string" && hostMatches(host, pattern))) return false;
  } catch { /* Invalid config falls back to defaults, just as in the background. */ }
  return true;
}
