// Synthetic DOM only, in about:blank. No accounts, messages, or file:// navigation.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/browser-issues.mjs /path/to/baseline
import { bundle, bundleExtension } from './issue-fixture-bundle.mjs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.argv[2]) throw new Error('Pass the baseline checkout path (7d33d617974304c03734900db299b58fd90e1960).');
const root = resolve(import.meta.dirname, '..');
const code = { before: await bundle(resolve(process.argv[2])), after: await bundle(root) };
const extension = {};
for (const [label, path] of Object.entries({ before: resolve(process.argv[2]), after: root })) extension[label] = { background: await bundleExtension(path, 'background'), isolated: await bundleExtension(path, 'content/isolated') };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = { browser: browser.version(), fixture: 'Synthetic about:blank DOM, no network or accounts', runs: [] };
try {
  for (let run = 0; run < 3; run++) {
    const values = {};
    for (const label of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.setContent('<!doctype html><html><head></head><body></body></html>');
      await page.evaluate(() => { window.__webLaasIsolatedAlive = () => true; });
      await page.addScriptTag({ content: code[label] });
      values[label] = await page.evaluate(async () => {
        const api = window.bench, d = document, out = {};
        const elapsed = (fn) => { const start = performance.now(); fn(); return performance.now() - start; };
        const ta = d.createElement('textarea');
        ta.style.cssText = 'width: 300px; height: 100px; font: 16px/24px monospace; padding: 8px; border: 2px solid black';
        ta.value = 'a long synthetic draft '.repeat(250); d.body.append(ta); ta.setSelectionRange(155, 155);
        const adapter = new api.TextFieldAdapter(ta);
        let appends = 0; const append = d.body.appendChild.bind(d.body);
        d.body.appendChild = (node) => { appends++; return append(node); };
        const rect = adapter.caretRect();
        const mirrorMs = elapsed(() => { for (let i = 0; i < 100; i++) { ta.setSelectionRange(i * 10, i * 10); adapter.caretRect(); } });
        out.textarea = { iterations: 101, milliseconds: mirrorMs, bodyAppends: appends, caret: rect };
        d.body.appendChild = append; d.body.innerHTML = '';
        const ce = d.createElement('div'); ce.contentEditable = 'true'; ce.innerHTML = '<p>synthetic paragraph abcdef</p>'.repeat(2000); d.body.append(ce);
        const edit = new api.ContentEditableAdapter(ce); let reads = 0;
        const desc = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data');
        Object.defineProperty(ce.firstChild.firstChild, 'data', { get() { reads++; return desc.get.call(this); } });
        d.getSelection().setBaseAndExtent(ce.firstChild.firstChild, 2, ce.lastChild.firstChild, 4);
        let ceMs = 0;
        for (let i = 0; i < 25; i++) {
          ceMs += elapsed(() => { const sel = edit.getSelection(); edit.textBefore(sel.to, 3000); edit.getSelection(); });
          await Promise.resolve();
        }
        out.contenteditable = { paragraphs: 2000, operations: 25, milliseconds: ceMs, fullLinearizations: reads };
        d.body.innerHTML = '<div><span>no formula</span></div>'.repeat(5000) + '<textarea>plain text</textarea>';
        let wildcardVisits = 0, queries = 0; const query = d.querySelectorAll.bind(d);
        d.querySelectorAll = (s) => { const found = query(s); if (s === '*') wildcardVisits += found.length; queries++; return found; };
        const scopeMs = elapsed(() => { for (let i = 0; i < 25; i++) api.editorsHaveMath(); });
        out.shadowDiscovery = { checks: 25, milliseconds: scopeMs, wildcardVisits };
        const intervals = new Map(); let next = 1;
        const originalInterval = window.setInterval, originalClear = window.clearInterval;
        window.setInterval = (fn) => { const id = next++; intervals.set(id, fn); return id; };
        window.clearInterval = (id) => intervals.delete(id);
        const cm = new api.CM5Math(); cm.set(true, false); queries = 0;
        const cmMs = elapsed(() => { for (let i = 0; i < 10; i++) for (const fn of intervals.values()) fn(); });
        out.cm5Idle = { simulatedSeconds: 15, milliseconds: cmMs, documentQueries: queries, intervals: intervals.size };
        cm.set(false, false); window.setInterval = originalInterval; window.clearInterval = originalClear; d.querySelectorAll = query;
        d.body.innerHTML = Array.from({ length: 80 }, (_, i) => `<div class="sent" style="height:40px">synthetic ${i}: $x_${i}+1$</div>`).join('');
        window.scrollTo(0, document.body.scrollHeight);
        const sources = [...d.querySelectorAll('.sent')];
        const timer = window.setTimeout.bind(window); let maxTask = 0, firstBatchCopies, firstVisible;
        window.setTimeout = (fn, delay, ...args) => timer(() => {
          const start = performance.now(); fn(...args); maxTask = Math.max(maxTask, performance.now() - start);
          const copies = d.querySelectorAll('[data-web-laas-msg-copy]').length;
          if (copies && firstBatchCopies === undefined) { firstBatchCopies = copies; firstVisible = sources.some(s => { const b = (s.nextElementSibling?.hasAttribute('data-web-laas-msg-copy') ? s.nextElementSibling : s).getBoundingClientRect(); return s.hasAttribute('data-web-laas-msg') && b.bottom >= 0 && b.top <= innerHeight; }); }
        }, delay);
        const messages = new api.MessageRender(d, '.sent'); const start = performance.now(); messages.set(true);
        await new Promise((resolve, reject) => { const poll = () => { if (d.querySelectorAll('[data-web-laas-msg-copy]').length === 80) resolve(); else if (performance.now() - start > 15000) reject(new Error('message timeout')); else timer(poll, 10); }; poll(); });
        out.messages = { count: 80, totalMilliseconds: performance.now() - start, maxTimerTaskMilliseconds: maxTask, firstBatchCopies, visibleInFirstBatch: firstVisible };
        messages.destroy(); window.setTimeout = timer; window.scrollTo(0, 0);
        // Browser-computed content-visibility and actual editor/clip geometry.
        d.body.innerHTML = '<textarea style="margin-top:80px;width:300px;height:80px">$x$</textarea>';
        d.body.style.cssText = 'margin:0;height:30px;overflow:hidden';
        const clipping = [];
        for (const target of [d.documentElement, d.body]) for (const value of ['auto', 'hidden']) {
          target.style.contentVisibility = value;
          const editor = d.querySelector('textarea');
          const renderer = new api.InlineRender(d);
          renderer.set({ on: true, comments: false });
          await new Promise(resolve => timer(resolve, 100));
          const drawnOutsideBody = renderer.states.get(editor)?.drawn.length ?? 0;
          clipping.push({ target: target.tagName, value, computed: getComputedStyle(target).contentVisibility, clipsBody: api.clippersOf(editor).includes(d.body), bodyHeight: d.body.getBoundingClientRect().height, drawnOutsideBody });
          renderer.destroy();
          target.style.contentVisibility = '';
        }
        out.clipping = clipping;
        d.body.style.cssText = '';
        return out;
      });
      await page.close();
    }
    results.runs.push(values);
  }
  results.composer = {};
  for (const label of ['before', 'after']) {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    await page.evaluate(() => {
      window.fixture = { store: { disabledHosts: ['chatgpt.com'], prefs: { composer: true, inlineRender: false } }, changed: [], messages: [], injections: 0 };
      const f = window.fixture, noopEvent = { addListener() {} };
      window.chrome = {
        storage: { local: { get: async () => f.store }, onChanged: { addListener: fn => f.changed.push(fn) } },
        runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => f.messages.push(fn) }, onStartup: noopEvent, onInstalled: noopEvent,
          sendMessage: msg => new Promise(resolve => { const result = f.messages[0](msg, { tab: { id: 1 }, frameId: 0, url: 'https://chatgpt.com/' }, resolve); if (result !== true) resolve(undefined); }) },
        scripting: { executeScript: async ({ files }) => { if (files.includes('composer.js')) f.injections++; return []; } },
        commands: { onCommand: noopEvent, getAll: async () => [] },
      };
    });
    await page.addScriptTag({ content: extension[label].background });
    await page.addScriptTag({ content: extension[label].isolated });
    await page.waitForTimeout(100);
    const beforeReenable = await page.evaluate(() => window.fixture.injections);
    await page.evaluate(() => { const f = window.fixture; f.store.disabledHosts = []; f.changed.forEach(fn => fn({ disabledHosts: { newValue: [] } }, 'local')); });
    await page.waitForTimeout(100);
    const afterReenable = await page.evaluate(() => window.fixture.injections);
    results.composer[label] = { beforeReenable, afterReenable };
    await page.close();
  }
  if (results.composer.after.beforeReenable !== 0 || results.composer.after.afterReenable !== 1) throw new Error('composer re-enable regression');
  // Assertions are on effects and correctness, not flaky wall-clock thresholds.
  for (const { before, after } of results.runs) {
    if (!after.clipping.every(x => x.clipsBody && x.drawnOutsideBody === 0)) throw new Error('implicit containment regression');
    if (JSON.stringify(before.textarea.caret) !== JSON.stringify(after.textarea.caret)) throw new Error('caret geometry changed');
    if (after.textarea.bodyAppends !== 1 || after.contenteditable.fullLinearizations !== 25 || after.cm5Idle.documentQueries !== 0) throw new Error('work reduction regression');
    if (!(after.shadowDiscovery.wildcardVisits < before.shadowDiscovery.wildcardVisits)) throw new Error('shadow discovery regression');
    if (after.messages.firstBatchCopies > 4 || !after.messages.visibleInFirstBatch) throw new Error('message prioritization regression');
  }
  await writeFile(resolve(root, 'evidence/issue-browser-results.json'), JSON.stringify(results, null, 2));
  console.log('PASS: synthetic browser correctness + same-host performance evidence saved to evidence/issue-browser-results.json');
} catch (error) {
  await writeFile(resolve(root, 'evidence/issue-browser-results.json'), JSON.stringify({ ...results, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
