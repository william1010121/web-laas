// Searchable snippet cheat sheet, shared by the options page and the in-page overlay.
import katex from "katex";
import type { CheatsheetEntry, CheatsheetGroup, SnippetSource } from "web-laas-engine";
import { fixMathvariants } from "./mathvariant";

export interface SheetOptions {
  /** shown as a chip next to the title (e.g. the current site) */
  host?: string;
  /** adds a close button and Esc handling */
  onClose?: () => void;
  /** keyboard hint shown in the footer */
  shortcut?: string;
  autofocus?: boolean;
}

type Filter = "all" | "math" | "text" | "tab" | "user";

const FILTERS: [Filter, string][] = [
  ["all", "全部"],
  ["math", "數學"],
  ["text", "文字"],
  ["tab", "按 Tab"],
  ["user", "我的"],
];

const ORIGIN: Record<SnippetSource, string> = { laas: "laas", extras: "Web 擴充", cdlatex: "cdlatex", user: "我的" };

const mathCache = new Map<string, string | null>();
function mathml(latex: string): string | null {
  if (!mathCache.has(latex)) {
    try {
      mathCache.set(
        latex,
        fixMathvariants(katex.renderToString(latex, { output: "mathml", throwOnError: true, strict: "ignore" })),
      );
    } catch {
      mathCache.set(latex, null);
    }
  }
  return mathCache.get(latex)!;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function kbd(doc: Document, text: string, cls = "lw-k") {
  return el(doc, "kbd", cls, text);
}

/** For regex snippets the description reads "input → output": show the input as the key. */
function displayTrigger(e: CheatsheetEntry): { key: string; note?: string } {
  if (e.isRegex && e.description) {
    const [lhs, ...rest] = e.description.split("→");
    if (rest.length) return { key: lhs.trim(), note: e.description };
    return { key: "regex", note: e.description };
  }
  return { key: e.trigger, note: e.description };
}

function renderItem(doc: Document, e: CheatsheetEntry): HTMLElement {
  const item = el(doc, "div", "lw-item");
  item.title = e.code;
  const { key, note } = displayTrigger(e);

  const left = el(doc, "div", "lw-left");
  left.append(el(doc, "span", "lw-key", key.replace(/ $/, "␣")));
  if (!e.auto) left.append(el(doc, "span", "lw-tag", "Tab"));
  item.append(left);

  const out = el(doc, "div", "lw-out");
  const html = e.preview ? mathml(e.preview) : null;
  if (html) {
    try {
      out.innerHTML = html;
    } catch {
      out.textContent = e.preview;
    }
  } else {
    out.append(el(doc, "code", "lw-code", e.code.replace(/\n\t?/g, " ").replace(/\$\d/g, "▢").trim()));
  }
  item.append(out);
  if (note && note !== key) item.append(el(doc, "div", "lw-note", note));
  item.dataset.search = [key, e.trigger, e.code, e.description ?? "", e.group].join(" ").toLowerCase();
  return item;
}

function matches(e: CheatsheetEntry, f: Filter) {
  if (f === "math") return e.mode !== "text";
  if (f === "text") return e.mode !== "math";
  if (f === "tab") return !e.auto;
  if (f === "user") return e.source === "user";
  return true;
}

const SEARCH_ICON =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.2 13.2 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export function buildCheatsheet(doc: Document, groups: CheatsheetGroup[], opts: SheetOptions = {}): HTMLElement {
  const root = el(doc, "div", "lw-sheet");

  // ── header ──
  const head = el(doc, "header", "lw-head");
  const titleRow = el(doc, "div", "lw-title-row");
  const title = el(doc, "div", "lw-title");
  title.append(el(doc, "span", "lw-logo", "∑"), el(doc, "span", "lw-name", "LaTeX Snippets"));
  if (opts.host) title.append(el(doc, "span", "lw-host", opts.host));
  titleRow.append(title);
  if (opts.onClose) {
    const close = el(doc, "button", "lw-close");
    close.type = "button";
    close.title = "關閉 (Esc)";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "✕";
    close.onclick = () => opts.onClose!();
    titleRow.append(close);
  }
  head.append(titleRow);

  const intro = el(doc, "p", "lw-intro");
  intro.append(
    "在數學模式（",
    el(doc, "code", "lw-ic", "$…$"),
    " 內）打出左邊的按鍵，會自動變成右邊的結果。",
    el(doc, "b", "", "x"),
    " 代表游標左邊的東西，",
    el(doc, "b", "", "□"),
    " 是展開後要填的欄位；按 ",
    kbd(doc, "Tab"),
    " 跳到下一格或跳出括號，展開後立刻按 ",
    kbd(doc, "⌫"),
    " 可以還原。",
  );
  head.append(intro);

  const tools = el(doc, "div", "lw-tools");
  const searchWrap = el(doc, "label", "lw-search");
  const icon = el(doc, "span", "lw-search-icon");
  icon.innerHTML = SEARCH_ICON;
  const search = el(doc, "input");
  search.type = "search";
  search.placeholder = "搜尋按鍵或指令，例如 alpha、frac、;a";
  search.spellcheck = false;
  searchWrap.append(icon, search);
  tools.append(searchWrap);

  const seg = el(doc, "div", "lw-seg");
  seg.setAttribute("role", "tablist");
  let filter: Filter = "all";
  for (const [f, label] of FILTERS) {
    if (f === "user" && !groups.some((g) => g.source === "user")) continue;
    const b = el(doc, "button", "lw-seg-btn", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.classList.toggle("on", f === filter);
    b.onclick = () => {
      filter = f;
      seg.querySelectorAll(".lw-seg-btn").forEach((x) => x.classList.toggle("on", x === b));
      apply();
    };
    seg.append(b);
  }
  tools.append(seg);
  head.append(tools);
  root.append(head);

  // ── body: group nav + sections ──
  const main = el(doc, "div", "lw-main");
  const nav = el(doc, "nav", "lw-nav");
  const body = el(doc, "div", "lw-body");
  const sections: {
    section: HTMLElement;
    link: HTMLButtonElement;
    count: HTMLElement;
    items: [HTMLElement, CheatsheetEntry][];
  }[] = [];

  let lastSource: SnippetSource | null = null;
  for (const g of groups) {
    const name = g.group.includes(" · ") ? g.group.split(" · ").slice(1).join(" · ") : g.group;
    if (g.source !== lastSource) {
      nav.append(el(doc, "div", "lw-nav-origin", ORIGIN[g.source]));
      lastSource = g.source;
    }
    const link = el(doc, "button", "lw-nav-link");
    link.type = "button";
    const count = el(doc, "span", "lw-nav-count");
    link.append(el(doc, "span", "lw-nav-name", name), count);
    nav.append(link);

    const section = el(doc, "section", "lw-group");
    const h = el(doc, "h3", "lw-group-title");
    h.append(el(doc, "span", "", name), el(doc, "span", `lw-origin lw-origin-${g.source}`, ORIGIN[g.source]));
    section.append(h);
    const grid = el(doc, "div", "lw-grid");
    const items: [HTMLElement, CheatsheetEntry][] = [];
    for (const e of g.entries) {
      const item = renderItem(doc, e);
      grid.append(item);
      items.push([item, e]);
    }
    section.append(grid);
    body.append(section);
    link.onclick = () => body.scrollTo({ top: section.offsetTop - 12, behavior: "smooth" });
    sections.push({ section, link, count, items });
  }
  const empty = el(doc, "div", "lw-empty");
  empty.append(el(doc, "div", "lw-empty-title", "找不到符合的 snippet"), el(doc, "div", "", "換個關鍵字，或切回「全部」"));
  body.append(empty);
  main.append(nav, body);
  root.append(main);

  // ── footer ──
  const foot = el(doc, "footer", "lw-foot");
  const hint = (keys: string[], label: string) => {
    const s = el(doc, "span", "lw-hint");
    for (const k of keys) s.append(kbd(doc, k));
    s.append(el(doc, "span", "", label));
    foot.append(s);
  };
  if (opts.shortcut) hint([opts.shortcut], "開／關");
  if (opts.onClose) hint(["Esc"], "關閉");
  hint(["Tab"], "下一格・跳出括號");
  hint(["⇧", "Tab"], "上一格");
  hint(["⌫"], "還原剛才的展開");
  const total = el(doc, "span", "lw-total");
  foot.append(total);
  root.append(foot);

  // ── behaviour ──
  function apply() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const s of sections) {
      let n = 0;
      for (const [item, e] of s.items) {
        const ok = matches(e, filter) && (!q || item.dataset.search!.includes(q));
        item.hidden = !ok;
        if (ok) n++;
      }
      s.section.hidden = n === 0;
      s.link.hidden = n === 0;
      s.count.textContent = String(n);
      shown += n;
    }
    nav.querySelectorAll<HTMLElement>(".lw-nav-origin").forEach((o) => {
      // hide an origin heading when all of its links are hidden
      let next = o.nextElementSibling as HTMLElement | null;
      let any = false;
      while (next && !next.classList.contains("lw-nav-origin")) {
        if (!next.hidden) any = true;
        next = next.nextElementSibling as HTMLElement | null;
      }
      o.hidden = !any;
    });
    empty.hidden = shown > 0;
    total.textContent = `${shown} 個 snippet`;
    syncNav();
  }
  function syncNav() {
    const top = body.scrollTop + 24;
    let active = sections.find((s) => !s.section.hidden);
    // before layout (or at the very top) every offsetTop is 0: keep the first group
    if (body.scrollTop > 4) {
      for (const s of sections) if (!s.section.hidden && s.section.offsetTop <= top) active = s;
    }
    for (const s of sections) s.link.classList.toggle("on", s === active);
  }
  body.addEventListener("scroll", syncNav, { passive: true });
  search.addEventListener("input", apply);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opts.onClose) {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
    }
  });
  apply();
  if (opts.autofocus) queueMicrotask(() => search.focus());
  return root;
}

export const SHEET_CSS = `
.lw-sheet {
  --lw-bg: #fbfbfa; --lw-surface: #ffffff; --lw-sunken: #f3f3f1;
  --lw-fg: #1d1d1f; --lw-fg-2: #3a3a3e; --lw-muted: #76767c; --lw-faint: #a8a8ad;
  --lw-line: #ebebe8; --lw-line-2: #dededa;
  --lw-accent: #0f766e; --lw-accent-fg: #ffffff; --lw-accent-soft: #e3f1ef; --lw-accent-text: #0f6b64;
  --lw-key-bg: #f1f1ee; --lw-key-fg: #2c2c30; --lw-key-line: #e2e2de;
  --lw-math: #141416; --lw-hover: #f4f4f1;
  --lw-extras: #9a5b12; --lw-extras-soft: #f6ecdf; --lw-user: #5a4fcf; --lw-user-soft: #ecebfb;
  --lw-shadow-seg: 0 1px 2px rgba(0,0,0,.08), 0 0 0 .5px rgba(0,0,0,.06);
  display: flex; flex-direction: column; min-height: 0; height: 100%;
  background: var(--lw-bg); color: var(--lw-fg);
  font: 14px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .lw-sheet {
    --lw-bg: #18181a; --lw-surface: #1e1e21; --lw-sunken: #141416;
    --lw-fg: #ececef; --lw-fg-2: #cfcfd4; --lw-muted: #8d8d94; --lw-faint: #5f5f66;
    --lw-line: #27272b; --lw-line-2: #323237;
    --lw-accent: #4fb8aa; --lw-accent-fg: #0d1514; --lw-accent-soft: rgba(79,184,170,.13); --lw-accent-text: #6ccabd;
    --lw-key-bg: #26262a; --lw-key-fg: #e4e4e8; --lw-key-line: #34343a;
    --lw-math: #f4f4f6; --lw-hover: #202024;
    --lw-extras: #e0a764; --lw-extras-soft: rgba(224,167,100,.12); --lw-user: #a7a1ff; --lw-user-soft: rgba(167,161,255,.13);
    --lw-shadow-seg: 0 1px 2px rgba(0,0,0,.4), 0 0 0 .5px rgba(255,255,255,.06);
  }
}
.lw-sheet *, .lw-sheet *::before, .lw-sheet *::after { box-sizing: border-box; }
.lw-sheet [hidden] { display: none !important; }
.lw-sheet button { font: inherit; color: inherit; }

/* header */
.lw-head { padding: 18px 24px 14px; border-bottom: 1px solid var(--lw-line); display: flex; flex-direction: column; gap: 12px; background: var(--lw-surface); }
.lw-title-row { display: flex; align-items: center; gap: 12px; }
.lw-title { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.lw-logo { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--lw-accent); color: var(--lw-accent-fg); font: 18px/1 Georgia, "Times New Roman", serif; flex: none; }
.lw-name { font-weight: 650; font-size: 16px; letter-spacing: -.01em; }
.lw-host { font-size: 12px; color: var(--lw-muted); padding: 2px 9px; border-radius: 999px; background: var(--lw-sunken); border: 1px solid var(--lw-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lw-close { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: var(--lw-muted); font-size: 14px; }
.lw-close:hover { background: var(--lw-sunken); color: var(--lw-fg); }
.lw-intro { margin: 0; color: var(--lw-fg-2); font-size: 13px; line-height: 1.65; max-width: 76ch; }
.lw-intro b { font: 600 13px/1 Georgia, "Times New Roman", serif; font-style: italic; color: var(--lw-fg); }
.lw-ic { font: 12px ui-monospace, "SF Mono", Menlo, monospace; padding: 1px 5px; border-radius: 5px; background: var(--lw-sunken); color: var(--lw-fg); }
.lw-k { display: inline-block; min-width: 20px; text-align: center; font: 500 11.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace; padding: 0 6px; border-radius: 5px; background: var(--lw-key-bg); color: var(--lw-key-fg); box-shadow: inset 0 -1px 0 var(--lw-key-line), 0 0 0 1px var(--lw-key-line); margin: 0 1px; }
.lw-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lw-search { flex: 1 1 280px; min-width: 0; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 10px; background: var(--lw-sunken); border: 1px solid transparent; color: var(--lw-muted); cursor: text; transition: border-color .12s, box-shadow .12s, background .12s; }
.lw-search:focus-within { background: var(--lw-surface); border-color: var(--lw-accent); box-shadow: 0 0 0 3px var(--lw-accent-soft); }
.lw-search-icon { display: grid; }
.lw-search input { all: unset; flex: 1; min-width: 0; color: var(--lw-fg); font-size: 14px; }
.lw-search input::placeholder { color: var(--lw-faint); }
.lw-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--lw-sunken); }
.lw-seg-btn { all: unset; cursor: pointer; padding: 5px 12px; border-radius: 7px; font-size: 12.5px; color: var(--lw-muted); white-space: nowrap; }
.lw-seg-btn:hover { color: var(--lw-fg); }
.lw-seg-btn.on { background: var(--lw-surface); color: var(--lw-fg); font-weight: 600; box-shadow: var(--lw-shadow-seg); }

/* main */
.lw-main { flex: 1; min-height: 0; display: grid; grid-template-columns: 196px minmax(0, 1fr); }
.lw-nav { overflow: auto; padding: 14px 10px 20px; border-right: 1px solid var(--lw-line); background: var(--lw-surface); }
.lw-nav-origin { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--lw-faint); padding: 12px 10px 4px; }
.lw-nav-origin:first-child { padding-top: 2px; }
.lw-nav-link { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 7px; font-size: 13px; color: var(--lw-fg-2); }
.lw-nav-link:hover { background: var(--lw-hover); }
.lw-nav-link.on { background: var(--lw-accent-soft); color: var(--lw-accent-text); font-weight: 600; }
.lw-nav-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-nav-count { font-size: 11.5px; color: var(--lw-faint); font-variant-numeric: tabular-nums; }
.lw-nav-link.on .lw-nav-count { color: inherit; opacity: .7; }
.lw-body { position: relative; overflow: auto; padding: 6px 24px 28px; overscroll-behavior: contain; scroll-padding-top: 12px; }
.lw-group { padding-top: 18px; }
.lw-group-title { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px 2px; font-size: 13.5px; font-weight: 650; color: var(--lw-fg); }
.lw-origin { font-size: 11px; font-weight: 500; color: var(--lw-muted); }
.lw-origin-extras { color: var(--lw-extras); }
.lw-origin-cdlatex { color: var(--lw-accent-text); }
.lw-origin-user { color: var(--lw-user); }
.lw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 4px; }
.lw-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; min-height: 40px; padding: 6px 10px 6px 8px; border-radius: 9px; background: var(--lw-surface); border: 1px solid var(--lw-line); }
.lw-item:hover { border-color: var(--lw-line-2); background: var(--lw-hover); }
.lw-left { display: flex; align-items: center; gap: 6px; min-width: 0; }
.lw-key { font: 500 12.5px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 5px 7px; border-radius: 6px; background: var(--lw-key-bg); color: var(--lw-key-fg); white-space: pre; }
.lw-tag { font-size: 10.5px; font-weight: 600; padding: 2px 6px; border-radius: 5px; color: var(--lw-accent-text); background: var(--lw-accent-soft); }
.lw-out { flex: 0 1 auto; min-width: 0; max-width: 100%; text-align: right; color: var(--lw-math); font-size: 16px; line-height: 1.2; overflow: hidden; }
.lw-out math { font-size: 1em; }
.lw-code { font: 11.5px ui-monospace, "SF Mono", Menlo, monospace; color: var(--lw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.lw-note { flex-basis: 100%; font-size: 11.5px; color: var(--lw-muted); margin: -2px 0 0 2px; }
.lw-empty { text-align: center; padding: 72px 0; color: var(--lw-muted); font-size: 13px; }
.lw-empty-title { color: var(--lw-fg); font-weight: 600; font-size: 14px; margin-bottom: 4px; }

/* footer */
.lw-foot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 10px 24px; border-top: 1px solid var(--lw-line); background: var(--lw-surface); font-size: 12px; color: var(--lw-muted); }
.lw-hint { display: inline-flex; align-items: center; gap: 5px; }
.lw-total { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--lw-faint); }

@media (max-width: 760px) {
  .lw-main { grid-template-columns: 1fr; }
  .lw-nav { display: none; }
  .lw-body { padding: 4px 16px 24px; }
  .lw-head, .lw-foot { padding-left: 16px; padding-right: 16px; }
}
`;
