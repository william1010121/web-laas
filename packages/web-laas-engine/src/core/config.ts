import { parseConfigText } from "./parser";
import { tokenizeTemplate, type TemplateToken } from "./template";
import { CDLATEX_CONFIG_TEXT, DEFAULT_CONFIG_TEXT, EXTRAS_CONFIG_TEXT } from "./defaults";
import type { ModifySpec } from "./cdlatex";

export type SnippetSource = "user" | "laas" | "extras" | "cdlatex";

export interface Snippet {
  index: number;
  /** literal trigger, or null for a regex trigger */
  trigger: string | null;
  /** regex anchored at the end of the text, for regex triggers */
  regex: RegExp | null;
  /** original trigger as written (used for de-duplication / display) */
  key: string;
  /** replacement template as written */
  replacement: string;
  template: TemplateToken[];
  auto: boolean;
  mode: { text: boolean; inline: boolean; display: boolean };
  wordBoundary: boolean;
  needsObject: boolean;
  priority: number;
  sites: string[] | null;
  excludeSites: string[] | null;
  source: SnippetSource;
  group: string;
  /** human-readable explanation (shown in the cheat sheet) */
  description?: string;
  /** LaTeX shown as the rendered result in the cheat sheet */
  preview?: string;
  /** `action: "cdlatex-modify"`: apply a cdlatex accent/font to what precedes the trigger */
  modify?: ModifySpec;
}

export interface CompiledConfig {
  snippets: Snippet[];
  disabledSites: string[];
  latexCommentSites: string[];
}

export interface ConfigIssue {
  message: string;
}

export interface CompileOptions {
  /** include the web extras set (mk, dm, sum, lim, …); default true */
  extras?: boolean;
  /** include cdlatex's tables (` symbols, ' modifiers, _ ^, Tab commands); default true */
  cdlatex?: boolean;
}

interface RawConfig {
  useDefaults?: boolean;
  removeDefaults?: unknown[];
  variables?: Record<string, string>;
  snippets?: unknown[];
  disabledSites?: string[];
  latexCommentSites?: string[];
}

type RawSnippet = Record<string, unknown>;

const OPTION_LETTERS = new Set(["t", "m", "n", "M", "A", "r", "w", "o"]);
const INHERITED = ["options", "sites", "excludeSites", "priority"] as const;

function asRaw(v: unknown, where: string): RawConfig {
  if (Array.isArray(v)) return { snippets: v };
  if (v && typeof v === "object") return v as RawConfig;
  throw new Error(`${where}: top level must be an object { ... } or an array [ ... ]`);
}

function triggerKey(t: unknown): string {
  return t instanceof RegExp ? `/${t.source}/` : String(t);
}

/**
 * Flatten groups: `{ group: "Greek", options: "mA", snippets: [...] }` passes
 * its group name and options/sites/priority down to the snippets inside.
 */
function flatten(list: unknown[], inherited: RawSnippet, issues: ConfigIssue[], where: string): RawSnippet[] {
  const out: RawSnippet[] = [];
  list.forEach((raw, k) => {
    const label = `${where}[${k}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof RegExp) {
      issues.push({ message: `${label}: must be an object` });
      return;
    }
    const s = raw as RawSnippet;
    if (Array.isArray(s.snippets) && s.trigger === undefined) {
      const next: RawSnippet = { ...inherited };
      if (typeof s.group === "string") next.group = s.group;
      for (const key of INHERITED) if (s[key] !== undefined) next[key] = s[key];
      out.push(...flatten(s.snippets, next, issues, `${label}.snippets`));
    } else {
      out.push({ ...inherited, ...s, __label: label });
    }
  });
  return out;
}

function compileSnippets(
  list: RawSnippet[],
  variables: Record<string, string>,
  issues: ConfigIssue[],
  startIndex: number,
  source: SnippetSource,
  defaultGroup: string,
): Snippet[] {
  const out: Snippet[] = [];
  for (const s of list) {
    const label = String(s.__label);
    const opts = typeof s.options === "string" ? s.options : "";
    for (const ch of opts) {
      if (!OPTION_LETTERS.has(ch)) issues.push({ message: `${label}: unknown option '${ch}'` });
    }
    let modify: ModifySpec | undefined;
    if (s.action !== undefined) {
      if (s.action !== "cdlatex-modify" || typeof s.command !== "string") {
        issues.push({ message: `${label}: action must be "cdlatex-modify" with a command string` });
        continue;
      }
      modify = { command: s.command, accent: s.accent !== false, rmdot: s.rmdot === true };
    } else if (typeof s.replacement !== "string") {
      issues.push({ message: `${label}: replacement must be a string` });
      continue;
    }
    const replacement = typeof s.replacement === "string" ? s.replacement : "";
    let trigger: string | null = null;
    let regex: RegExp | null = null;
    const subst = (src: string) =>
      src.replace(/\$\{([A-Za-z_]\w*)\}/g, (m, name) => (name in variables ? `(?:${variables[name]})` : m));
    try {
      if (s.trigger instanceof RegExp) {
        const flags = s.trigger.flags.replace(/[gy]/g, "");
        regex = new RegExp(`(?:${subst(s.trigger.source)})$`, flags);
      } else if (typeof s.trigger === "string" && s.trigger.length > 0) {
        if (opts.includes("r")) regex = new RegExp(`(?:${subst(s.trigger)})$`);
        else trigger = s.trigger;
      } else {
        issues.push({ message: `${label}: trigger must be a non-empty string or /regex/` });
        continue;
      }
    } catch (e) {
      issues.push({ message: `${label}: ${(e as Error).message}` });
      continue;
    }
    const t = opts.includes("t");
    const m = opts.includes("m");
    const n = opts.includes("n");
    const M = opts.includes("M");
    const any = !t && !m && !n && !M;
    const strList = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    out.push({
      index: startIndex + out.length,
      trigger,
      regex,
      key: triggerKey(s.trigger),
      replacement: modify ? modify.command : replacement,
      template: tokenizeTemplate(replacement),
      auto: opts.includes("A"),
      mode: { text: any || t, inline: any || m || n, display: any || m || M },
      wordBoundary: opts.includes("w"),
      needsObject: opts.includes("o"),
      priority: typeof s.priority === "number" ? s.priority : 0,
      sites: strList(s.sites),
      excludeSites: strList(s.excludeSites),
      source,
      group: str(s.group) ?? defaultGroup,
      description: str(s.description),
      preview: str(s.preview),
      modify,
    });
  }
  return out;
}

let builtinCache: { laas: RawConfig; extras: RawConfig; cdlatex: RawConfig } | null = null;
function builtins() {
  return (builtinCache ??= {
    laas: asRaw(parseConfigText(DEFAULT_CONFIG_TEXT), "defaults"),
    extras: asRaw(parseConfigText(EXTRAS_CONFIG_TEXT), "extras"),
    cdlatex: asRaw(parseConfigText(CDLATEX_CONFIG_TEXT), "cdlatex"),
  });
}

/** Compile user config text (null = built-ins only). Throws ParseError on syntax errors. */
export function compileConfig(
  userText: string | null,
  options: CompileOptions = {},
): { config: CompiledConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const { laas, extras, cdlatex } = builtins();
  const user: RawConfig = userText && userText.trim() ? asRaw(parseConfigText(userText), "config") : {};

  const variables = { ...(laas.variables ?? {}), ...(extras.variables ?? {}), ...(user.variables ?? {}) };
  const userRaw = flatten(user.snippets ?? [], {}, issues, "config snippets");
  const snippets = compileSnippets(userRaw, variables, issues, 0, "user", "我的 snippet");

  if (user.useDefaults !== false) {
    const removed = new Set((user.removeDefaults ?? []).map(triggerKey));
    // Precedence: user > cdlatex > extras > laas. A trigger defined by a
    // higher set hides the lower sets' versions (in Emacs, cdlatex's ' and _
    // take the key before laas ever sees it).
    const sets: [SnippetSource, RawConfig][] = [];
    if (options.cdlatex !== false) sets.push(["cdlatex", cdlatex]);
    if (options.extras !== false) sets.push(["extras", extras]);
    sets.push(["laas", laas]);
    const taken = new Set(snippets.map((s) => s.key));
    const compiled: Snippet[][] = [];
    for (const [source, raw] of sets) {
      const flat = flatten(raw.snippets ?? [], {}, issues, `${source} snippets`);
      const keep = flat.filter((r) => {
        const k = triggerKey(r.trigger);
        return !removed.has(k) && !taken.has(k);
      });
      for (const r of flat) taken.add(triggerKey(r.trigger));
      compiled.push(compileSnippets(keep, variables, issues, 0, source, source));
    }
    // list them laas, extras, cdlatex (for the cheat sheet), then re-index
    for (const list of compiled.reverse()) snippets.push(...list);
    snippets.forEach((s, i) => (s.index = i));
  }

  return {
    config: {
      snippets,
      disabledSites: user.disabledSites ?? laas.disabledSites ?? [],
      latexCommentSites: user.latexCommentSites ?? laas.latexCommentSites ?? [],
    },
    issues,
  };
}

/** "overleaf.com" matches overleaf.com and any subdomain; "*." prefix is optional. */
export function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/^\*\./, "");
  if (!p) return false;
  const h = host.toLowerCase();
  return h === p || h.endsWith("." + p);
}

export function snippetsForHost(config: CompiledConfig, host: string): Snippet[] {
  return config.snippets.filter(
    (s) =>
      (!s.sites || s.sites.some((p) => hostMatches(host, p))) &&
      !(s.excludeSites && s.excludeSites.some((p) => hostMatches(host, p))),
  );
}

export type InlineMathStyle = "auto" | "dollar" | "paren";
export type DisplayMathStyle = "auto" | "ddollar" | "bracket" | "equation";

/** Which delimiters mk / dm insert ("auto": the built-in choice for the site). */
export interface MathDelimiters {
  inline?: InlineMathStyle;
  display?: DisplayMathStyle;
}

const MATH_DELIMITERS: Record<string, [replacement: string, description: string]> = {
  dollar: ["$$1$$0", "行內數學 $…$"],
  paren: ["\\($1\\)$0", "行內數學 \\(…\\)"],
  ddollar: ["$$\n$1\n$$$0", "區塊數學 $$…$$"],
  bracket: ["\\[\n\t$1\n\\]$0", "區塊數學 \\[…\\]"],
  equation: ["\\begin{equation*}\n\t$1\n\\end{equation*}$0", "區塊數學 equation*"],
};

/** The built-in mk / dm snippets rewritten to insert the chosen delimiters (your own mk / dm are left alone). */
export function withMathDelimiters(snippets: Snippet[], d: MathDelimiters | undefined): Snippet[] {
  if (!d) return snippets;
  return snippets.map((s) => {
    if (s.source !== "extras") return s;
    const style = s.key === "mk" ? d.inline : s.key === "dm" ? d.display : undefined;
    const pick = style && style !== "auto" ? MATH_DELIMITERS[style] : undefined;
    if (!pick) return s;
    return { ...s, replacement: pick[0], template: tokenizeTemplate(pick[0]), description: pick[1] };
  });
}
