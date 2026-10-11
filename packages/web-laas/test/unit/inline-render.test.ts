// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { domText, formulasIn } from "../../src/preview/inline";

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
    expect(domText(html('<pre><div class="CodeMirror-gutter-wrapper">12</div><span>x</span></pre><pre><span>​</span></pre>')).text).toBe("x\n\n");
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
