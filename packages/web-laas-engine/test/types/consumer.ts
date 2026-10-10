// Type-checked as a consumer would, through the published "exports"/"types":
// once with moduleResolution nodenext (Node ESM) and once with bundler.
import { compileConfig, findExpansion, snippetsForHost, type CompiledConfig, type Snippet } from "web-laas-engine";
import { DEFAULT_PREFS, LaasController, type EditorAdapter, type LaasPrefs } from "web-laas-engine/dom";

const config: CompiledConfig = compileConfig(null).config;
const snippets: Snippet[] = snippetsForHost(config, "example.com");
const text: string | undefined = findExpansion(snippets, "$x/", { auto: true })?.rendered.text;
const prefs: LaasPrefs = { ...DEFAULT_PREFS, autoSpace: false };
const adapter = (el: Element): EditorAdapter | null => (el ? null : null);
export const used = [text, prefs, adapter, LaasController];
