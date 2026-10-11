// The showcase page: replays scenes recorded with the real engine (tools/simulate.ts),
// runs the real engine, live preview and in-place rendering in the playground, and
// embeds the real cheat sheet.
import {
  cheatsheetEntries,
  compileConfig,
  findFormulas,
  groupCheatsheet,
  resolveMathDelimiters,
  snippetsForHost,
  withMathDelimiters,
} from "web-laas-engine";
import { LaasController } from "web-laas-engine/dom";
import { buildCheatsheet, SHEET_CSS } from "../../packages/web-laas/src/cheatsheet/sheet";
import { InlineRender } from "../../packages/web-laas/src/preview/inline";
import { LivePreview, prepareLatex } from "../../packages/web-laas/src/preview/preview";
import { MATH_CSS, renderMath } from "../../packages/web-laas/src/shared/math";
import { accentColor } from "../../packages/web-laas/src/shared/theme";

interface State {
  t: number;
  text: string;
  caret: number;
  key?: string;
  label?: string;
  tag?: string;
  changed?: [number, number];
  f?: { latex: string; caret: number; display: boolean; env?: string };
}
type Scenes = Record<string, { end: number; states: State[] }>;

const style = document.createElement("style");
style.textContent = MATH_CSS + SHEET_CSS;
document.head.append(style);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── scene player ────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** LaTeX source with light syntax colouring, a caret and the engine's last change marked. */
function sourceHtml(s: State): string {
  const text = s.text;
  const [c0, c1] = s.changed ?? [-1, -1];
  let out = "";
  let i = 0;
  const mark = (from: number, to: number, cls: string) => {
    let seg = "";
    for (let k = from; k < to; k++) {
      if (k === s.caret) seg += '<span class="caret"></span>';
      const inChange = k >= c0 && k < c1;
      seg += inChange ? `<span class="chg">${esc(text[k])}</span>` : esc(text[k]);
    }
    return cls ? `<span class="${cls}">${seg}</span>` : seg;
  };
  const re = /\\[A-Za-z]+|\\.|[$]|[{}]|[\^_]/g;
  for (let m; (m = re.exec(text)); ) {
    out += mark(i, m.index, "");
    const tok = m[0];
    const cls = tok === "$" ? "t-dollar" : tok === "{" || tok === "}" ? "t-brace" : tok === "^" || tok === "_" ? "t-script" : "t-cmd";
    out += mark(m.index, m.index + tok.length, cls);
    i = m.index + tok.length;
  }
  out += mark(i, text.length, "");
  if (s.caret >= text.length) out += '<span class="caret"></span>';
  return out;
}

function mathHtml(s: State): string {
  if (s.f) {
    const { withCaret, plain } = prepareLatex(s.f, accentColor());
    return renderMath(withCaret ?? plain, s.f.display) ?? renderMath(plain, s.f.display) ?? "";
  }
  // caret outside math: the formulas so far, rendered
  const fs = findFormulas(s.text);
  return fs.map((f) => renderMath(f.latex, f.display) ?? "").join('<span class="gap"></span>');
}

const TAGS: Record<string, string> = { laas: "laas", cdlatex: "cdlatex", web: "web extras", tab: "Tab" };

class Player {
  private states: State[];
  private end: number;
  private start = 0;
  private frame = 0;
  private shown = -1;
  private code: HTMLElement;
  private math: HTMLElement;
  private caps: HTMLElement;
  private pill: HTMLElement;
  private mathCache = new Map<number, string>();

  constructor(el: HTMLElement, scene: { end: number; states: State[] }) {
    this.states = scene.states;
    this.end = scene.end + 1.4; // a pause on the result before looping
    this.code = el.querySelector(".code")!;
    this.math = el.querySelector(".math")!;
    this.caps = el.querySelector(".caps")!;
    this.pill = el.querySelector(".pill")!;
    if (reduced) this.show(this.states.length - 1);
    else this.show(0);
  }

  play() {
    if (reduced || this.frame) return;
    const t0 = this.states[Math.max(0, this.shown)]?.t ?? 0;
    this.start = performance.now() - t0 * 1000;
    const step = (now: number) => {
      const t = (now - this.start) / 1000;
      if (t > this.end) {
        this.start = now;
        this.show(0);
      } else {
        let i = this.shown;
        while (i + 1 < this.states.length && this.states[i + 1].t <= t) i++;
        if (i !== this.shown) this.show(i);
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  pause() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private show(i: number) {
    this.shown = i;
    const s = this.states[i];
    this.code.innerHTML = sourceHtml(s);
    let html = this.mathCache.get(i);
    if (html === undefined) this.mathCache.set(i, (html = mathHtml(s)));
    this.math.innerHTML = html;
    // the last few keys, newest last
    const keys: string[] = [];
    for (let k = i; k > 0 && keys.length < 9; k--) if (this.states[k].key) keys.unshift(this.states[k].key!);
    this.caps.innerHTML = keys
      .map((k, n) => `<kbd class="${n === keys.length - 1 && i > 0 ? "on" : ""}">${k === " " ? "␣" : esc(k)}</kbd>`)
      .join("");
    // the most recent expansion, if any
    let lab: State | undefined;
    for (let k = i; k > 0; k--) if (this.states[k].label) { lab = this.states[k]; break; }
    this.pill.innerHTML = lab ? `<span class="tag tag-${lab.tag}">${TAGS[lab.tag!] ?? ""}</span>${esc(lab.label!)}` : "";
  }
}

async function players() {
  const els = [...document.querySelectorAll<HTMLElement>("[data-scene]")];
  if (!els.length) return;
  const scenes: Scenes = await (await fetch("assets/scenes.json")).json();
  const byEl = new Map<Element, Player>();
  for (const el of els) {
    const sc = scenes[el.dataset.scene!];
    if (sc) byEl.set(el, new Player(el, sc));
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = byEl.get(e.target);
        if (!p) continue;
        if (e.isIntersecting) p.play();
        else p.pause();
      }
    },
    { threshold: 0.35 },
  );
  for (const el of byEl.keys()) io.observe(el);
}

// ── playground: the real engine, preview card and in-place rendering ────

function playground() {
  const ta = document.getElementById("try") as HTMLTextAreaElement | null;
  if (!ta) return;
  const preview = new LivePreview(document);
  preview.setMode("above");
  // only the playground: the cheat sheet's search box must stay a plain search box
  new LaasController({ host: "example.com", filter: (el) => el === ta, onFormula: (f) => preview.update(f) }).attach();
  // Esc hides the card for this formula, as in the extension
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && preview.visible) preview.dismiss();
    },
    true,
  );
  new InlineRender(document).set({ on: true, comments: false });
  document.getElementById("try-reset")?.addEventListener("click", () => {
    ta.value = ta.defaultValue;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

// ── the cheat sheet, as the extension builds it ─────────────────────────

function cheatsheet() {
  const host = document.getElementById("sheet");
  if (!host) return;
  const { config } = compileConfig(null);
  if (!config) return;
  const site = "example.com";
  const groups = groupCheatsheet(cheatsheetEntries(withMathDelimiters(snippetsForHost(config, site), resolveMathDelimiters({}, site))));
  host.replaceChildren(buildCheatsheet(document, groups, { host: "any site" }));
}

// ── page chrome ─────────────────────────────────────────────────────────

function counts() {
  const { config } = compileConfig(null);
  if (!config) return;
  const n = (src: string) => config.snippets.filter((s) => s.source === src).length;
  for (const el of document.querySelectorAll<HTMLElement>("[data-count]")) {
    const src = el.dataset.count!;
    el.textContent = String(src === "all" ? config.snippets.length : n(src));
  }
}

counts();
cheatsheet();
playground();
void players();
