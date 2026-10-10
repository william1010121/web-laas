// Run: npm run serve:test (in another shell), then: ego-browser nodejs < test/editor/e2e.ego.mjs
// Reuse a space with EGO_SPACE=<id>; otherwise one named below is created/resumed.
const task = await taskSpace(Number(process.env.EGO_SPACE) || "web-laas-engine editor tests");
console.log({ space: task.spaceId });
const page = await task.newPage();
await page.cdp("Page.bringToFront"); // background tabs throttle timers
const pages = ["textarea", "contenteditable", "prosemirror", "cm6", "cm5"];
const scenarios = [
  { name: "frac+tab+greek (auto space)", keys: [" mk", "x/", "y", "Tab", "+;a"], expect: "$\\frac{x}{y}+\\alpha $" },
  { name: "sum tabstops+subscript", keys: [" mk", "sum", "i=1", "Tab", "n", "Tab", "a1"], expect: "$\\sum_{i=1}^{n} a_1$" },
  { name: "accent+sr", keys: [" mk", "x'.", "sr"], expect: "$\\dot{x}^2$" },
  { name: "laas subscripts", keys: [" mk", "xii+y_1", "2"], expect: "$x_i+y_{12}$" },
  { name: "Tab leaves inline math", keys: [" mk", "x", "Tab", " done"], expect: "$x$ done" },
  { name: "backspace revert", keys: [" mk", "Backspace", " ok"], expect: " mk ok" },
  { name: "text mode untouched", keys: [" x sr ->"], expect: " x sr ->" },
  { name: "default selected", keys: [" mk", "lim", "k", "Tab", "Tab", "a"], expect: "$\\lim_{k \\to \\infty} a$" },
  { name: "nested in field", keys: [" mk", "sum", "a/", "b", "Tab", "Tab", "n", "Tab", "x"], expect: "$\\sum_{\\frac{a}{b}}^{n} x$" },
  { name: "Tab leaves own brackets inside a field", keys: [" mk", "\\sqrt{x}", "ArrowLeft", "Tab", "Tab", " ok"], expect: "$\\sqrt{x}$ ok" },
  { name: "Shift+Tab back to a field", keys: [" mk", "sum", "i", "Tab", "ShiftTab", "k", "Tab", "n"], expect: "$\\sum_{k}^{n} $" },
  { name: "cdlatex $ pair + step over", keys: [" $", "x$", " ok"], expect: " $x$ ok" },
  { name: "cdlatex ' modify + ` symbol", keys: [" mk", "ab'.", "+`b"], expect: "$a\\dot{b}+\\beta$" },
  { name: "cdlatex fr⇥ then Tab through groups", keys: [" mk", "fr", "Tab", "1", "Tab", "2", "Tab", "Tab", " ok"], expect: "$\\frac{1}{2}$ ok" },
  { name: "x then '[", keys: [" mk", "x'[", "y"], expect: "$x\\left[ y \\right]$" },
  { name: "space then '[ (editor auto-closes ')", keys: [" mk", "a '[", "y"], expect: "$a \\left[ y \\right]$" },
  { name: "space then '.", keys: [" mk", "a '.", "y"], expect: "$a \\dot{y}$" },
  { name: "Shift+Tab stays in math", keys: [" mk", "\\frac{a}{b}", "ShiftTab", "ShiftTab", "z"], expect: "$\\frac{az}{b}$" },
  { name: "IME-style insert: ` then a", keys: [" mk", "x ", "ins:`", "ins:a"], expect: "$x \\alpha$" },
  { name: "IME-style insert: ' then [", keys: [" mk", "y ", "ins:'", "ins:["], expect: "$y \\left[  \\right]$" },
  { name: "standalone 'b", keys: [" mk", "a+'b", "z"], expect: "$a+\\mathbf{z}$" },
  { name: "dm multiline", keys: [" dm", "x"], expect: "$$\nx\n$$" },
  { name: "tab passthrough", keys: [" q", "Tab", "z"], expect: "qz", not: true, skip: ["cm6"] /* CM6 indentWithTab indents the line */ },
];
const results = [];
for (const name of pages) {
  await page.goto(`http://localhost:8765/test/editor/${name}.html`);
  await page.waitForFunction(() => window.webLaas && window.editorText, undefined, { timeout: 10000 });
  // wait until timers run unthrottled (the engine checks some editors on a 0ms timer)
  await page.waitForFunction(
    () => new Promise((r) => { const t = performance.now(); setTimeout(() => r(performance.now() - t < 20), 0); }),
    undefined,
    { timeout: 10000 },
  );
  for (const sc of scenarios) {
    if (sc.skip?.includes(name)) continue;
    await page.click(name === "cm6" ? ".cm-content" : name === "cm5" ? ".CodeMirror" : name === "prosemirror" ? ".ProseMirror" : "#editor");
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.press("Enter");
    for (const k of sc.keys) {
      if (k === "ShiftTab") await page.keyboard.press("Shift+Tab");
      else if (k.startsWith("ins:")) await page.keyboard.insertText(k.slice(4)); // no keydown, like an IME commit
      else if (["Tab", "Backspace", "ArrowLeft"].includes(k)) await page.keyboard.press(k);
      else await page.keyboard.type(k, { delay: 15 });
      await page.waitForTimeout(40);
    }
    // the engine checks the last typed character on a timer; wait for it
    await page.waitForFunction(() => !window.webLaas.pending, undefined, { timeout: 5000 });
    const text = await page.evaluate(() => window.editorText());
    const ok = sc.not ? !text.includes(sc.expect) : text.includes(sc.expect);
    results.push({ page: name, scenario: sc.name, ok, ...(ok ? {} : { tail: text.slice(-80) }) });
  }
}
for (const r of results) console.log(JSON.stringify(r));
console.log("PASS", results.filter((r) => r.ok).length, "/", results.length);
await page.close();
