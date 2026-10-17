// Data for a snippet cheat sheet: what to type, what you get, and where it works.
import type { Snippet, SnippetSource } from "./config";
import { tokenizeTemplate } from "./template";

export interface CheatsheetEntry {
  /** what to type (the regex description for regex triggers without one) */
  trigger: string;
  isRegex: boolean;
  /** replacement template as written */
  code: string;
  /** LaTeX to render as the result, or null for text-mode snippets */
  preview: string | null;
  mode: "math" | "text" | "any";
  auto: boolean;
  /** needs an object on the left (x/ , x'.) */
  wraps: boolean;
  group: string;
  source: SnippetSource;
  description?: string;
}

export interface CheatsheetGroup {
  group: string;
  source: SnippetSource;
  entries: CheatsheetEntry[];
}

const PLACEHOLDER = "\\square";

/** LaTeX that shows what a snippet produces (tabstops as □, the wrapped object as x). */
export function previewLatex(s: Snippet): string | null {
  if (s.preview !== undefined) return s.preview || null;
  if (s.modify) {
    const { command: c, accent } = s.modify;
    return c.includes("?") ? c.replace("?", "x") : accent ? `${c}{x}` : `{${c} x}`;
  }
  // (a snippet that brings its own math delimiters shows what goes inside them)
  if (!s.mode.inline && !s.mode.display && !s.wrap) return null;
  if (s.regex) return null;
  let out = "";
  for (const t of s.wrap ? tokenizeTemplate(s.replacement) : s.template) {
    if (t.kind === "text") out += t.text;
    else if (t.kind === "stop") out += t.n === 0 ? "" : t.def || PLACEHOLDER;
    else if (t.kind === "capture") out += "?";
    else out += t.name.startsWith("PREV") ? "x" : "";
  }
  out = out.trim();
  if (/^[_^]/.test(out)) out = "x" + out;
  return out || null;
}

export function cheatsheetEntries(snippets: Snippet[]): CheatsheetEntry[] {
  return snippets.map((s) => {
    const math = s.mode.inline || s.mode.display;
    return {
      trigger: s.trigger ?? s.key,
      isRegex: s.trigger === null,
      code: s.replacement,
      preview: previewLatex(s),
      mode: math && s.mode.text ? "any" : math ? "math" : "text",
      auto: s.auto,
      wraps: s.needsObject,
      group: s.group,
      source: s.source,
      description: s.description,
    };
  });
}

/** Group entries, keeping the order in which groups first appear. */
export function groupCheatsheet(entries: CheatsheetEntry[]): CheatsheetGroup[] {
  const map = new Map<string, CheatsheetGroup>();
  for (const e of entries) {
    let g = map.get(e.group);
    if (!g) map.set(e.group, (g = { group: e.group, source: e.source, entries: [] }));
    g.entries.push(e);
  }
  return [...map.values()];
}
