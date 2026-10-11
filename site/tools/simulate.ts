// Types each showcase scene into a textarea driven by the real web-laas engine
// (in jsdom) and records every state, so the site replays exactly what the
// extension does. Output: site/dist/scenes.json (see tools/build.mjs).
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";

const dom = new JSDOM(`<!doctype html><textarea id="t"></textarea>`, { pretendToBeVisual: true });
const g = globalThis as any;
for (const k of ["window", "document", "Node", "Element", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement",
  "KeyboardEvent", "InputEvent", "Event", "CompositionEvent", "getComputedStyle"]) {
  g[k] = k === "window" ? dom.window : (dom.window as any)[k];
}

const { LaasController } = await import("../../packages/web-laas-engine/src/dom");
const { formulaAt } = await import("../../packages/web-laas-engine/src");

const ta = document.getElementById("t") as HTMLTextAreaElement;
ta.focus();
new LaasController({ host: "example.com" }).attach();

interface Step {
  /** characters to type, or "⇥" / "⇧⇥" */
  keys: string;
  /** what the expansion pill says after the step */
  label?: string;
  tag?: "laas" | "cdlatex" | "web" | "tab";
  /** pause after the step, in seconds */
  hold?: number;
}

interface Scene {
  id: string;
  start: string;
  steps: Step[];
}

const SCENES: Scene[] = [
  {
    id: "laas",
    start: "The Pythagorean theorem: ",
    steps: [
      { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.8 },
      { keys: "a" },
      { keys: "sr", label: "sr  →  ^2", tag: "laas", hold: 0.9 },
      { keys: " + b" },
      { keys: "sr", label: "sr  →  ^2", tag: "laas", hold: 0.6 },
      { keys: " = c" },
      { keys: "sr", label: "sr  →  ^2", tag: "laas", hold: 0.9 },
      { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 0.6 },
      { keys: ", and " },
      { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.5 },
      { keys: ";a", label: ";a  →  \\alpha", tag: "laas", hold: 0.9 },
      { keys: "<=", label: "<=  →  \\leq", tag: "laas", hold: 0.9 },
      { keys: ";p", label: ";p  →  \\pi", tag: "laas", hold: 0.9 },
      { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 1.6 },
    ],
  },
  {
    id: "frac",
    start: "Simplify ",
    steps: [
      { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.5 },
      { keys: "x1", label: "x1  →  x_1", tag: "laas", hold: 0.8 },
      { keys: "/", label: "x_1/  →  \\frac{x_1}{ }", tag: "laas", hold: 1.0 },
      { keys: "2", hold: 0.3 },
      { keys: "⇥", label: "⇥  out of \\frac", tag: "tab", hold: 0.6 },
      { keys: " + " },
      { keys: "(a+b)/", label: "(a+b)/  →  \\frac{a+b}{ }", tag: "laas", hold: 1.1 },
      { keys: "c", hold: 0.3 },
      { keys: "⇥", label: "⇥  out of \\frac", tag: "tab", hold: 0.6 },
      { keys: " + " },
      { keys: "//", label: "//  →  \\frac{ }{ }", tag: "laas", hold: 0.9 },
      { keys: "1", hold: 0.3 },
      { keys: "⇥", label: "⇥  next field", tag: "tab", hold: 0.5 },
      { keys: "n", hold: 0.3 },
      { keys: "⇥", label: "⇥  out of \\frac", tag: "tab", hold: 0.5 },
      { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 1.6 },
    ],
  },
  {
    id: "cdlatex",
    start: "Velocity ",
    steps: [
      { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.5 },
      { keys: "v'b", label: "v'b  →  \\mathbf{v}", tag: "cdlatex", hold: 1.0 },
      { keys: " = " },
      { keys: "x'.", label: "x'.  →  \\dot{x}", tag: "cdlatex", hold: 1.0 },
      { keys: " + " },
      { keys: "`o", label: "`o  →  \\omega", tag: "cdlatex", hold: 0.9 },
      { keys: "_", label: "_  →  _{ }", tag: "cdlatex", hold: 0.5 },
      { keys: "0", hold: 0.3 },
      { keys: "⇥", label: "⇥  _{0}  →  _0", tag: "cdlatex", hold: 0.9 },
      { keys: " " },
      { keys: "sq" },
      { keys: "⇥", label: "sq ⇥  →  \\sqrt{ }", tag: "cdlatex", hold: 0.9 },
      { keys: "t", hold: 0.3 },
      { keys: "⇥", label: "⇥  out of \\sqrt", tag: "tab", hold: 0.5 },
      { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 1.6 },
    ],
  },
  {
    id: "tab",
    start: "Then ",
    steps: [
      { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.5 },
      { keys: "sum", label: "sum  →  \\sum_{ }^{ }", tag: "web", hold: 1.0 },
      { keys: "k=1", hold: 0.3 },
      { keys: "⇥", label: "⇥  next field", tag: "tab", hold: 0.6 },
      { keys: "n", hold: 0.3 },
      { keys: "⇥", label: "⇥  next field", tag: "tab", hold: 0.6 },
      { keys: "k" },
      { keys: "sr", label: "sr  →  ^2", tag: "laas", hold: 0.6 },
      { keys: " = " },
      { keys: "(n(n+1)(2n+1))/", label: "(…)/  →  \\frac{…}{ }", tag: "laas", hold: 1.0 },
      { keys: "6", hold: 0.3 },
      { keys: "⇥", label: "⇥  out of \\frac", tag: "tab", hold: 0.5 },
      { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 1.6 },
    ],
  },
];

const KEY_GAP = [0.13, 0.1, 0.16, 0.11, 0.14, 0.12, 0.09, 0.15]; // deterministic, human-ish rhythm

interface State {
  t: number;
  text: string;
  caret: number;
  key?: string;
  label?: string;
  tag?: string;
  /** the range the engine changed beyond the keystroke itself */
  changed?: [number, number];
  /** the formula around the caret */
  f?: { latex: string; caret: number; display: boolean; env?: string };
}

const tick = () => new Promise((r) => setTimeout(r, 2));
const out: Record<string, { end: number; states: State[] }> = {};

for (const scene of SCENES) {
  ta.value = scene.start;
  ta.setSelectionRange(ta.value.length, ta.value.length);
  const states: State[] = [{ t: 0, text: ta.value, caret: ta.selectionStart }];
  let t = 0.6;
  let k = 0;
  for (const step of scene.steps) {
    const keys = step.keys === "⇥" || step.keys === "⇧⇥" ? [step.keys] : [...step.keys];
    for (const [i, key] of keys.entries()) {
      t += KEY_GAP[k++ % KEY_GAP.length];
      const before = ta.value;
      const at = ta.selectionStart;
      if (key === "⇥" || key === "⇧⇥") {
        const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey: key === "⇧⇥", bubbles: true, cancelable: true });
        ta.dispatchEvent(e);
        if (!e.defaultPrevented) throw new Error(`${scene.id}: Tab not handled at "${ta.value}"`);
      } else {
        const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        ta.dispatchEvent(e);
        if (!e.defaultPrevented) {
          ta.setRangeText(key, ta.selectionStart, ta.selectionEnd, "end");
          ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: key, bubbles: true }));
        }
      }
      await tick();
      const s: State = { t: +t.toFixed(3), text: ta.value, caret: ta.selectionStart, key };
      const naive = key.length === 1 ? before.slice(0, at) + key + before.slice(at) : before;
      if (ta.value !== naive) {
        let p = 0;
        while (p < naive.length && naive[p] === ta.value[p]) p++;
        let q = 0;
        while (q < naive.length - p && naive[naive.length - 1 - q] === ta.value[ta.value.length - 1 - q]) q++;
        s.changed = [p, ta.value.length - q];
      }
      if (i === keys.length - 1 && step.label) {
        s.label = step.label;
        s.tag = step.tag;
      }
      const f = formulaAt(ta.value.slice(0, ta.selectionStart), ta.value.slice(ta.selectionStart));
      if (f) s.f = { latex: f.latex, caret: f.caret, display: f.display, ...(f.env ? { env: f.env } : {}) };
      states.push(s);
    }
    t += step.hold ?? 0.25;
  }
  out[scene.id] = { end: +(t + 0.6).toFixed(3), states };
  console.log(scene.id.padEnd(8), JSON.stringify(ta.value));
}

writeFileSync(process.argv[2], JSON.stringify(out));
