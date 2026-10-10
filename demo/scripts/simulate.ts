// Types the demo script into a textarea driven by the real web-laas engine
// (jsdom) and records every state, so the video shows exactly what the
// extension does. Output: assets/states.json
//   node scripts/build-states.mjs
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";

const dom = new JSDOM(`<!doctype html><textarea id="t"></textarea>`, { pretendToBeVisual: true });
const g = globalThis as any;
for (const k of ["window", "document", "Node", "Element", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement",
  "KeyboardEvent", "InputEvent", "Event", "CompositionEvent", "getComputedStyle"]) {
  g[k] = k === "window" ? dom.window : (dom.window as any)[k];
}

const { LaasController } = await import("../../packages/web-laas-engine/src/dom");

const ta = document.getElementById("t") as HTMLTextAreaElement;
ta.value = "Then ";
ta.focus();
ta.setSelectionRange(ta.value.length, ta.value.length);
new LaasController({ host: "example.com" }).attach();

const tick = () => new Promise((r) => setTimeout(r, 2));

type Step = {
  keys: string; // characters, or "⇥" / "⇧⇥"
  label?: string; // what the key bar's expansion pill says
  tag?: "laas" | "cdlatex" | "web" | "tab";
  hold?: number; // pause after this step (s)
};

// One formula, built with the snippets people reach for most.
const SCRIPT: Step[] = [
  { keys: "$", label: "$  →  $ … $", tag: "cdlatex", hold: 0.9 },
  { keys: ";a", label: ";a  →  \\alpha", tag: "laas", hold: 1.1 },
  { keys: "sr", label: "sr  →  ^2", tag: "laas", hold: 1.0 },
  { keys: " + " },
  { keys: "`b", label: "`b  →  \\beta", tag: "cdlatex", hold: 1.0 },
  { keys: " x1", label: "x1  →  x_1", tag: "laas", hold: 0.9 },
  { keys: "/", label: "x_1/  →  \\frac{x_1}{ }", tag: "laas", hold: 1.2 },
  { keys: "sq" },
  { keys: "⇥", label: "sq ⇥  →  \\sqrt{ }", tag: "cdlatex", hold: 0.9 },
  { keys: "y", hold: 0.4 },
  { keys: "⇥", label: "⇥  out of \\sqrt{ }", tag: "tab", hold: 0.9 },
  { keys: "⇥", label: "⇥  out of \\frac{ }{ }", tag: "tab", hold: 0.9 },
  { keys: " = " },
  { keys: "sum", label: "sum  →  \\sum_{ }^{ }", tag: "web", hold: 1.1 },
  { keys: "i=1", hold: 0.3 },
  { keys: "⇥", label: "⇥  next field", tag: "tab", hold: 0.6 },
  { keys: "n", hold: 0.3 },
  { keys: "⇥", label: "⇥  next field", tag: "tab", hold: 0.6 },
  { keys: "x'.", label: "x'.  →  \\dot{x}", tag: "cdlatex", hold: 1.1 },
  { keys: "_", label: "_  →  _{ }", tag: "cdlatex", hold: 0.6 },
  { keys: "i", hold: 0.4 },
  { keys: "⇥", label: "⇥  x_{i}  →  x_i", tag: "cdlatex", hold: 1.0 },
  { keys: "⇥", label: "⇥  out of the formula", tag: "tab", hold: 0.8 },
  { keys: "." },
];

const START = 4.6; // seconds into the video when typing begins
const KEY_GAP = [0.13, 0.1, 0.16, 0.11, 0.14, 0.12, 0.09, 0.15]; // deterministic human-ish rhythm

interface State {
  t: number;
  text: string;
  caret: number;
  key?: string; // the key pressed at t
  label?: string;
  tag?: string;
  changed?: [number, number]; // range the engine inserted (for a highlight)
}
const states: State[] = [{ t: 0, text: ta.value, caret: ta.selectionStart }];
let t = START;
let k = 0;

for (const step of SCRIPT) {
  const keys = step.keys === "⇥" || step.keys === "⇧⇥" ? [step.keys] : [...step.keys];
  keys.forEach((key, i) => {
    t += KEY_GAP[k++ % KEY_GAP.length];
    const before = ta.value;
    const at = ta.selectionStart;
    if (key === "⇥" || key === "⇧⇥") {
      const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey: key === "⇧⇥", bubbles: true, cancelable: true });
      ta.dispatchEvent(e);
      if (!e.defaultPrevented) throw new Error(`Tab was not handled at step ${step.keys}`);
    } else {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      ta.setRangeText(key, ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: key, bubbles: true }));
    }
    const s: State = { t: +t.toFixed(3), text: ta.value, caret: ta.selectionStart, key };
    // what the engine did on top of the keystroke itself
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
    states.push(s);
  });
  await tick();
  t += step.hold ?? 0.25;
}

const final = states[states.length - 1];
console.log(JSON.stringify(final.text));
writeFileSync(new URL("../assets/states.json", import.meta.url), JSON.stringify({ end: +t.toFixed(3), states }, null, 1));
console.log(`${states.length} states, typing ends at ${t.toFixed(2)}s`);
