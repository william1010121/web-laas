// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clippersOf, domText, formulasIn, InlineRender, splitPieces, stackingFor } from "../../src/preview/inline";

const html = (s: string) => {
  const el = document.createElement("div");
  el.innerHTML = s;
  return el;
};

describe("domText", () => {
  it("joins lines and keeps empty ones (CodeMirror 6, ProseMirror)", () => {
    expect(domText(html('<div class="cm-line">$$</div><div class="cm-line">x</div><div class="cm-line"><br></div><div class="cm-line">b</div>')).text).toBe("$$\nx\n\nb\n");
    expect(domText(html("<p>a <em>b</em></p><p><br></p><p>c</p>")).text).toBe("a b\n\nc\n");
  });

  it("counts a hard break, not a trailing one; skips widgets and gutters", () => {
    expect(domText(html("<p>a<br>b<br></p>")).text).toBe("a\nb\n");
    expect(domText(html('<p>$a<span contenteditable="false">w</span>b$</p>')).text).toBe("$a￼b$\n");
    expect(domText(html('<pre class="CodeMirror-line"><div class="CodeMirror-gutter-wrapper">12</div><span>x</span></pre><pre class="CodeMirror-line"><span>​</span></pre>')).text).toBe("x\n\n");
  });

  it("code holds no math; CodeMirror 5's <pre> lines are text", () => {
    const t = domText(html("<p>see <code>$x$</code> and $y$</p><pre><code>$z$\n</code></pre><p>$w$</p>"));
    expect(formulasIn(t.text, false, t.resumes).map((f) => f.latex)).toEqual(["y", "w"]);
    expect(domText(html('<pre class="CodeMirror-line"><span>$a$</span></pre>')).text).toBe("$a$\n");
  });

  it("nested blocks don't add blank lines", () => {
    expect(domText(html("<ul><li><p>a</p></li><li><p>b</p></li></ul>")).text).toBe("a\nb\n");
  });

  it("an undrawn stretch (cm-gap) starts a paragraph that may be cut", () => {
    const t = domText(html('<div class="cm-line">x$</div><div class="cm-gap"></div><div class="cm-line">a$ b</div><div class="cm-line"></div><div class="cm-line">$c$</div>'));
    // "a$ b" may be the end of a formula that began in the gap: only $c$ counts after it
    expect(formulasIn(t.text, false, t.resumes).map((f) => f.latex)).toEqual(["c"]);
  });

  it("maps formulas back to text nodes", () => {
    const t = domText(html("<p>see <b>$x</b>^2$ ok</p>"));
    const [f] = formulasIn(t.text, false, t.resumes);
    expect(t.text.slice(f.from, f.to)).toBe("$x^2$");
    expect(t.segs.map((s) => s.node.data)).toEqual(["see ", "$x", "^2$ ok"]);
  });
});

describe("clippersOf", () => {
  it("includes an editor that scrolls itself, and scrolling ancestors", () => {
    const outer = html('<div id="ed" contenteditable="true" style="overflow:auto">x</div>');
    outer.style.overflow = "hidden";
    document.body.append(outer);
    const ed = outer.querySelector("#ed")!;
    expect(clippersOf(ed)).toEqual([ed, outer]);
    (ed as HTMLElement).style.overflow = "visible";
    expect(clippersOf(ed)).toEqual([outer]);
    outer.remove();
  });
});

describe("formulasIn after undrawn lines", () => {
  const t = domText(html('<div class="cm-gap"></div><div class="cm-line">b = c$ then $d$</div><div class="cm-line">and $e$</div>'));

  it("reads the cut paragraph from its undrawn start", () => {
    // the undrawn part opened a formula: "b = c$" closes it, so "$ then $" is not one
    // (LaTeX rules: "$ then $" would be math if nothing were open)
    expect(formulasIn(t.text, true, t.resumes, ["see $a + "]).map((f) => f.latex)).toEqual(["d", "e"]);
    // the undrawn part had no open formula
    expect(formulasIn(t.text, true, t.resumes, ["plain text "]).map((f) => f.latex)).toEqual([" then ", "\nand "]);
  });

  it("without it, leaves the paragraph out", () => {
    expect(formulasIn(t.text, false, t.resumes)).toEqual([]);
  });

  it("offsets still point into the drawn text", () => {
    const [f] = formulasIn(t.text, false, t.resumes, ["see $a + "]);
    expect(t.text.slice(f.from, f.to)).toBe("$d$");
  });
});

describe("text field mirror", () => {
  it("cuts after every 32nd line and keeps all of the text", () => {
    const text = Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n");
    const pieces = splitPieces(text);
    expect(pieces.join("")).toBe(text);
    expect(pieces.map((p) => p.split("\n").length)).toEqual([33, 33, 6]);
  });

  it("stays the field's text through edits anywhere", () => {
    const r = new InlineRender(document) as any;
    const m = { el: document.createElement("div"), sig: "", value: "", pieces: [] as { start: number; text: Text }[] };
    document.body.append(m.el);
    let value = Array.from({ length: 200 }, (_, i) => `row ${i} $x_{${i}}$`).join("\n");
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 48271) % 2147483647) % n);
    const check = () => {
      expect(m.pieces.map((p) => p.text.data).join("")).toBe(value);
      expect(m.el.textContent).toBe(value);
      let pos = 0;
      for (const p of m.pieces) {
        expect(p.start).toBe(pos);
        pos += p.text.data.length;
      }
    };
    r.syncMirror(m, value);
    check();
    for (let k = 0; k < 300; k++) {
      const at = rand(value.length + 1);
      const del = rand(4) === 0 ? rand(80) : rand(3);
      const ins = ["x", "\n", "", "a\nb\n", "\n".repeat(40), "$y$"][rand(6)];
      value = value.slice(0, at) + ins + value.slice(at + del);
      r.syncMirror(m, value);
      check();
    }
    r.syncMirror(m, "");
    value = "";
    check();
    m.el.remove();
  });
});

describe("stackingFor", () => {
  it("places the layer in the stacking context the editor paints in", () => {
    const wrap = html('<textarea style="position:relative;z-index:3"></textarea>');
    document.body.append(wrap);
    const ta = wrap.querySelector("textarea")!;
    // the editor is a context of its own: beside it, at its level, in the page's context
    expect(stackingFor(ta)).toEqual({ context: document.documentElement, z: 3 });
    // ... or in its container's
    wrap.style.cssText = "position:relative;z-index:7";
    expect(stackingFor(ta)).toEqual({ context: wrap, z: 3 });
    // a plain editor in a dialog: inside the dialog, under the dialog's own popups
    ta.style.cssText = "";
    wrap.style.cssText = "position:fixed;z-index:1000";
    expect(stackingFor(ta)).toEqual({ context: wrap, z: 0 });
    // text on a level of its own inside the editor (CodeMirror 5's lines): above that level
    const ed = html('<div class="ed"><pre style="position:relative;z-index:2"><span>line</span></pre></div>');
    wrap.append(ed);
    expect(stackingFor(ed.firstElementChild!)).toEqual({ context: wrap, z: 2 });
    ed.remove();
    // nothing anywhere: the page's context
    wrap.style.cssText = "";
    expect(stackingFor(ta)).toEqual({ context: document.documentElement, z: 0 });
    wrap.remove();
  });
});

describe("an orphaned renderer", () => {
  it("stops for good once the extension is gone", () => {
    let alive = true;
    const r = new InlineRender(document, { alive: () => alive }) as any;
    r.set({ on: true, comments: false });
    expect(r.on).toBe(true);
    alive = false;
    r.update();
    expect(r.on).toBe(false);
    r.schedule(); // nothing is scheduled any more
    expect(r.frame).toBe(0);
  });
});
