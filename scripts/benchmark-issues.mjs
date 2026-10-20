// Synthetic, same-process jsdom comparison. This measures JS/DOM work, NOT browser layout.
// npm ci; node scripts/benchmark-issues.mjs /path/to/baseline-checkout
import { bundle } from "./issue-fixture-bundle.mjs";
import { JSDOM } from "jsdom";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
const current = resolve(import.meta.dirname, "..");
if (!process.argv[2]) throw new Error("Pass the baseline checkout path (7d33d617974304c03734900db299b58fd90e1960).");
const baseline = resolve(process.argv[2]);
const elapsed = (fn) => { const start = performance.now(); fn(); return performance.now() - start; };
async function run(code) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.__webLaasIsolatedAlive = () => true;
  w.eval(code);
  const api = w.bench;
  const out = {};
  const ta = d.createElement('textarea'); ta.value = 'a long synthetic draft '.repeat(250); d.body.append(ta);
  const adapter = new api.TextFieldAdapter(ta);
  let appends = 0;
  const append = d.body.appendChild.bind(d.body);
  d.body.appendChild = (node) => { appends++; return append(node); };
  out.textarea = { iterations: 100, milliseconds: elapsed(() => { for (let i = 0; i < 100; i++) adapter.caretRect(); }), bodyAppends: appends, retainedMirrors: d.querySelectorAll('[data-web-laas-mirror]').length };
  d.body.appendChild = append; d.body.innerHTML = '';
  const ce = d.createElement('div'); ce.innerHTML = '<p>synthetic paragraph abcdef</p>'.repeat(2000); d.body.append(ce);
  const edit = new api.ContentEditableAdapter(ce);
  let reads = 0;
  const desc = Object.getOwnPropertyDescriptor(w.CharacterData.prototype, 'data');
  Object.defineProperty(ce.firstChild.firstChild, 'data', { get() { reads++; return desc.get.call(this); } });
  d.getSelection().setBaseAndExtent(ce.firstChild.firstChild, 2, ce.lastChild.firstChild, 4);
  let ceMs = 0;
  for (let i = 0; i < 25; i++) {
    ceMs += elapsed(() => { const s = edit.getSelection(); edit.textBefore(s.to, 3000); edit.getSelection(); });
    await Promise.resolve();
  }
  out.contenteditable = { paragraphs: 2000, operations: 25, milliseconds: ceMs, fullLinearizations: reads };
  d.body.innerHTML = '<div><span>no formula</span></div>'.repeat(5000) + '<textarea>plain text</textarea>';
  let wildcardVisits = 0, queries = 0;
  const query = d.querySelectorAll.bind(d);
  d.querySelectorAll = (s) => { const found = query(s); if (s === '*') wildcardVisits += found.length; queries++; return found; };
  const scopeMs = elapsed(() => { for (let i = 0; i < 25; i++) api.editorsHaveMath(); });
  out.shadowDiscovery = { elements: 10004, checks: 25, milliseconds: scopeMs, wildcardVisits };
  const intervals = new Map(); let next = 1;
  w.setInterval = (fn) => { const id = next++; intervals.set(id, fn); return id; };
  w.clearInterval = (id) => intervals.delete(id);
  const cm = new api.CM5Math(); cm.set(true, false); queries = 0;
  const cmMs = elapsed(() => { for (let i = 0; i < 10; i++) for (const fn of intervals.values()) fn(); });
  out.cm5Idle = { simulatedSeconds: 15, milliseconds: cmMs, documentQueries: queries, intervals: intervals.size };
  cm.set(false, false); d.querySelectorAll = query;
  d.body.innerHTML = Array.from({ length: 80 }, (_, i) => `<div class="sent">synthetic ${i}: $x_${i}+1$</div>`).join('');
  const sources = [...d.querySelectorAll('.sent')];
  sources.forEach((s, i) => s.getBoundingClientRect = () => ({ top: i === 79 ? 10 : -100, bottom: i === 79 ? 40 : -50 }));
  const timer = w.setTimeout.bind(w);
  let maxTask = 0, firstBatchCopies, firstVisible;
  w.setTimeout = (fn, delay, ...args) => timer(() => {
    const start = performance.now(); fn(...args); maxTask = Math.max(maxTask, performance.now() - start);
    const copies = d.querySelectorAll('[data-web-laas-msg-copy]').length;
    if (copies && firstBatchCopies === undefined) { firstBatchCopies = copies; firstVisible = sources[79].hasAttribute('data-web-laas-msg'); }
  }, delay);
  const messages = new api.MessageRender(d, '.sent');
  const start = performance.now(); messages.set(true);
  await new Promise((resolve, reject) => {
    const poll = () => { if (d.querySelectorAll('[data-web-laas-msg-copy]').length === 80) resolve(); else if (performance.now() - start > 15000) reject(new Error('message batch timed out')); else timer(poll, 10); }; poll();
  });
  out.messages = { count: 80, totalMilliseconds: performance.now() - start, maxTimerTaskMilliseconds: maxTask, firstBatchCopies, visibleInFirstBatch: firstVisible };
  messages.destroy(); dom.window.close();
  return out;
}
const code = { before: await bundle(baseline), after: await bundle(current) };
const results = { environment: { node: process.version, platform: process.platform, browserLayout: false }, runs: [] };
for (let i = 0; i < 3; i++) {
  // Alternate order to reduce warmup/order bias. Keep every run, not just the best.
  const order = i % 2 ? ['after', 'before'] : ['before', 'after'];
  const runResult = {};
  for (const label of order) runResult[label] = await run(code[label]);
  results.runs.push(runResult);
}
console.log(JSON.stringify(results, null, 2));
