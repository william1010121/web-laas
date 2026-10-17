// Typing on a long chat page (a ChatGPT-like conversation with a ProseMirror message box).
// ?turns=<n>&parts=engine,inline,messages,live (default: all) picks what runs, as preview.js
// and content-main.js would on chatgpt.com. window.keyLatency() / window.stream() drive it.
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { LaasController } from "web-laas-engine/dom";
import { InlineRender } from "../../../src/preview/inline";
import { MessageRender } from "../../../src/preview/messages";
import { LivePreview } from "../../../src/preview/preview";
import { messageSelector } from "../../../src/shared/chat";

const q = new URLSearchParams(location.search);
const turns = Number(q.get("turns") ?? 150);
const parts = new Set((q.get("parts") ?? "engine,inline,messages,live").split(",").filter(Boolean));

// KaTeX-like markup: lots of nested spans per formula, as the site's own typesetting leaves
const katex = (i: number) => {
  let inner = "";
  for (let k = 0; k < 6; k++) inner += `<span class="mord"><span class="vlist"><span class="sizing"><span class="mord mathnormal">x</span></span></span></span>`;
  return `<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x_${i}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${inner}</span></span>`;
};
const thread = document.getElementById("thread")!;
let html = "";
for (let t = 0; t < turns; t++) {
  const math = t % 3 === 0 ? ` with $\\frac{a_${t}}{b}$ and $x^${t % 9}$` : "";
  html += `<article data-turn="user"><div data-message-author-role="user"><div class="bubble"><div class="whitespace-pre-wrap">Question ${t}: how do I prove this${math}? Some more words so the message is a realistic length.</div></div></div></article>`;
  let reply = "";
  for (let p = 0; p < 10; p++) reply += `<p>Step ${p} of answer ${t}: since ${katex(p)} holds, we get ${katex(p + 1)} and therefore ${katex(p + 2)}, <strong>as claimed</strong>.</p>`;
  html += `<article data-turn="assistant"><div data-message-author-role="assistant"><div class="markdown prose">${reply}</div></div></article>`;
}
thread.innerHTML = html;

const box = document.getElementById("prompt")!;
// (with its keymap, as on the sites: the composer selects all with Mod-a before pasting its text)
const view = new EditorView(box, { state: EditorState.create({ schema, plugins: [keymap(baseKeymap)] }) });
view.dom.id = "prompt-textarea";
(window as any).pm = view;

const live = parts.has("live") ? new LivePreview(document) : null;
if (parts.has("engine")) {
  const c = new LaasController({ host: "chatgpt.com", onFormula: (f) => live?.update(f as never) });
  c.setState({ enabled: true, prefs: {} });
  c.attach();
}
if (parts.has("inline")) {
  const ir = new InlineRender(document);
  ir.set({ on: true, comments: false });
  // formulas drawn on screen now
  (window as any).boxes = () => [...((ir as any).boxes as Map<string, unknown[]>).values()].reduce((n, l) => n + l.length, 0);
}
if (parts.has("messages")) new MessageRender(document, messageSelector("chatgpt.com")!).set(true);

(window as any).nodes = () => document.getElementsByTagName("*").length;

// time from each keydown to the frame that shows it (what feels like lag)
const lat: number[] = [];
let pending: number[] = [];
window.addEventListener("keydown", () => pending.push(performance.now()), true);
document.addEventListener("input", () => {
  const ts = pending;
  pending = [];
  requestAnimationFrame(() => setTimeout(() => ts.forEach((t) => lat.push(performance.now() - t)), 0));
}, true);
// every key, also ones that change no text (Vim's normal mode): keydown → the frame after it
const keyFrames: number[] = [];
window.addEventListener("keydown", () => {
  const t = performance.now();
  requestAnimationFrame(() => setTimeout(() => keyFrames.push(performance.now() - t), 0));
}, true);
(window as any).frameLatency = () => {
  const s = [...keyFrames].sort((a, b) => a - b);
  const at = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(1);
  keyFrames.length = 0;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: at(1) };
};
const longTasks: number[] = [];
new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration))).observe({ entryTypes: ["longtask"] });
(window as any).keyLatency = () => {
  const s = [...lat].sort((a, b) => a - b);
  const at = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(1);
  const out = { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(1), p50: at(0.5), p95: at(0.95), max: at(1), longTasks: longTasks.length, longMs: Math.round(longTasks.reduce((a, b) => a + b, 0)) };
  lat.length = 0;
  longTasks.length = 0;
  return out;
};
// a reply streaming in: words appended to a new assistant message every `every` ms
(window as any).stream = (ms: number, every = 40) =>
  new Promise<void>((done) => {
    const art = document.createElement("article");
    art.innerHTML = `<div data-message-author-role="assistant"><div class="markdown prose"><p></p></div></div>`;
    thread.append(art);
    let p = art.querySelector("p")!;
    let k = 0;
    const id = setInterval(() => {
      p.append(`word${k++} `);
      if (k % 30 === 0) {
        p.insertAdjacentHTML("beforeend", katex(k));
        p = p.parentElement!.appendChild(document.createElement("p"));
      }
    }, every);
    setTimeout(() => (clearInterval(id), done()), ms);
  });
