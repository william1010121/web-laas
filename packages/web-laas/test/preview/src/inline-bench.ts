// Performance of rendering formulas in place on long documents.
// ?editor=cm6|pm|ce|ta&n=<paragraphs>; window.bench() returns the timings.
import "codemirror5/lib/codemirror.css";
import { basicSetup, EditorView as CM6View } from "codemirror";
import { EditorState } from "prosemirror-state";
import { EditorView as PMView } from "prosemirror-view";
import { DOMParser } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import CodeMirror from "codemirror5";
import { undrawnParagraphs } from "web-laas-engine/dom";
import { domText, formulasIn, InlineRender } from "../../../src/preview/inline";
import { findFormulas } from "web-laas-engine";
import { renderMath } from "../../../src/shared/math";
(window as any).parts = { domText, formulasIn, findFormulas };
(window as any).ir_ctor = InlineRender;
(window as any).renderMath = renderMath;

const q = new URLSearchParams(location.search);
const kind = q.get("editor") ?? "cm6";
const n = Number(q.get("n") ?? 2000);
// ?steps=k: k scroll jumps (the wheel and typing runs scale with it), for slow builds
const steps = Number(q.get("steps") ?? 80);

// every paragraph has two distinct inline formulas; every 10th is followed by a display one
const lines: string[] = [];
for (let i = 0; i < n; i++) {
  lines.push(`Paragraph ${i}: let $x_{${i}} = \\frac{${i}}{${i}+1}$ and $\\alpha^{${i}} + \\beta$ some text to make the line longer.`);
  if (i % 10 === 0) lines.push("$$", `\\sum_{k=1}^{${i}} k^2 = \\frac{${i}(${i}+1)(2\\cdot ${i}+1)}{6}`, "$$");
}
const text = lines.join("\n");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const host = document.getElementById("host")!;
let scroller: HTMLElement;
let edit: () => void;

if (kind === "cm6") {
  const view = new CM6View({ doc: text, extensions: [basicSetup, CM6View.lineWrapping], parent: host });
  scroller = view.scrollDOM;
  edit = () => view.dispatch({ changes: { from: view.state.doc.line(Math.floor(view.state.doc.lines / 2)).from, insert: "x" } });
} else if (kind === "cm5") {
  const cm = CodeMirror(host, { value: text, lineWrapping: true });
  cm.setSize("100%", "100%");
  scroller = host.querySelector(".CodeMirror-scroll") as HTMLElement;
  edit = () => cm.replaceRange("x", { line: cm.lineCount() >> 1, ch: 0 });
} else if (kind === "pm") {
  const div = document.createElement("div");
  div.innerHTML = lines.map((l) => `<p>${esc(l)}</p>`).join("");
  const view = new PMView(host, { state: EditorState.create({ doc: DOMParser.fromSchema(schema).parse(div) }) });
  scroller = host;
  edit = () => view.dispatch(view.state.tr.insertText("x", Math.floor(view.state.doc.content.size / 2)));
} else if (kind === "ce") {
  host.contentEditable = "true";
  host.innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join("");
  scroller = host;
  edit = () => {
    const t = host.children[Math.floor(host.children.length / 2)].firstChild as Text;
    t.data = "x" + t.data;
  };
} else {
  const ta = document.createElement("textarea");
  ta.value = text;
  host.append(ta);
  scroller = ta;
  edit = () => ta.setRangeText("x", ta.value.length >> 1, ta.value.length >> 1);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

(window as any).bench = async () => {
  await frame();
  await frame();
  const r = new InlineRender(document, { undrawn: (root, comments) => undrawnParagraphs(root, { comments }) });
  (window as any).ir = r;
  const boxes = () => [...((r as any).boxes as Map<string, unknown>).values()].reduce((n: number, l) => n + (Array.isArray(l) ? l.length : 1), 0);
  // time every update, whether a frame ran it (after a scroll, an edit…) or we did
  let spent: number[] = [];
  const update = r.update.bind(r);
  // the editor's own layout after a change is the browser's work, done first and timed apart
  let layout: number[] = [];
  r.update = () => {
    let t = performance.now();
    void scroller.offsetHeight;
    layout.push(performance.now() - t);
    t = performance.now();
    update();
    spent.push(performance.now() - t);
  };
  // the longest frame of the next two (one update per frame: scroll and mutation share it;
  // new formulas may be rendered over a few frames)
  const settle = async () => {
    spent = [];
    await frame();
    await frame();
    return spent.length ? Math.max(...spent) : 0;
  };
  r.set({ on: true, comments: false });
  const cold = await settle();
  const idle = [];
  for (let i = 0; i < 20; i++) {
    spent = [];
    r.update();
    idle.push(spent[0]);
  }
  // a sweep through the document, the way a scroll bar drag would
  const scroll = [];
  const max = scroller.scrollHeight - scroller.clientHeight;
  for (let i = 1; i <= steps; i++) {
    scroller.scrollTop = (max * i) / steps;
    scroll.push(await settle());
  }
  // small steps, like wheel ticks, in the middle
  const wheel = [];
  scroller.scrollTop = max / 2;
  await settle();
  await settle();
  for (let i = 0; i < steps / 2; i++) {
    scroller.scrollTop += 40;
    wheel.push(await settle());
  }
  const typing = [];
  const editorLayout = [];
  for (let i = 0; i < steps / 4; i++) {
    edit();
    layout = [];
    typing.push(await settle());
    editorLayout.push(layout.reduce((a, b) => a + b, 0));
  }
  const out = {
    impl: (window as any).IMPL ?? "new",
    editor: kind,
    paragraphs: n,
    chars: text.length,
    formulas: n * 2 + Math.ceil(n / 10),
    coldMs: +cold.toFixed(1),
    idle: stats(idle),
    scrollJump: stats(scroll),
    wheel: stats(wheel),
    typing: stats(typing),
    // not ours: the browser laying out the editor after each edit
    editorLayoutOnTyping: stats(editorLayout),
    boxesInDom: boxes(),
  };
  r.destroy();
  return out;
};
