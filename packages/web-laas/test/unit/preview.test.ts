import { describe, expect, it } from "vitest";
import { prepareLatex } from "../../src/preview/preview";
import { renderMath } from "../../src/shared/math";

const A = "#4fb8aa";
const MARK = `{\\color{${A}}\\rule{0.09em}{1em}}`;
const BOX = `{\\color{${A}}\\square}`;
const prep = (s: string, env?: string) => {
  const caret = s.indexOf("|");
  return prepareLatex({ latex: s.slice(0, caret) + s.slice(caret + 1), caret, env }, A);
};

describe("prepareLatex", () => {
  it("marks the caret and shows empty fields as boxes", () => {
    const p = prep("\\frac{a}{|}");
    expect(p.withCaret).toBe(`\\frac{a}{${MARK}}`);
    expect(p.plain).toBe(`\\frac{a}${BOX}`);
  });

  it("marks inside a script", () => {
    expect(prep("x^|").withCaret).toBe(`x^${MARK}`);
    expect(prep("x^{2|}").withCaret).toBe(`x^{2${MARK}}`);
  });

  it("never splits a command name", () => {
    expect(prep("\\alp|ha").withCaret).toBeNull();
    expect(prep("a + \\|").withCaret).toBeNull();
    expect(prep("\\alpha| + b").withCaret).not.toBeNull(); // right after a finished command is fine
  });

  it("wraps alignment environments so KaTeX can render them", () => {
    expect(prep("a &= b \\\\ c &= |d", "align*").plain).toBe("\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}");
    expect(prep("a \\\\ |b", "gather").plain).toBe("\\begin{gathered}a \\\\ b\\end{gathered}");
    expect(prep("a|", "equation").plain).toBe("a");
  });

  it("produces LaTeX KaTeX accepts", () => {
    for (const s of ["\\frac{a}{|}", "x^|", "\\sum_{i=1}^{n|} x_i", "\\sqrt{|}", "\\left( a| \\right)"]) {
      // the caret mark also fills a dangling script (x^ → x^{|}), so this one always renders
      expect(renderMath(prep(s).withCaret!), s).not.toBeNull();
    }
    expect(renderMath(prep("\\frac{a}{|}").plain)).not.toBeNull();
  });

  it("returns null for half-typed LaTeX, so the last render is kept", () => {
    expect(renderMath(prep("\\frac{a}{|").plain)).toBeNull();
  });
});

describe("LivePreview fallback", () => {
  it("keeps the last good render only for the formula being edited", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
    const g = globalThis as any;
    g.matchMedia = () => ({ matches: false });
    const { LivePreview } = await import("../../src/preview/preview");
    const p = new LivePreview(dom.window.document);
    const rect = { left: 10, top: 100, bottom: 120 };
    const html = () => (p as any).math.innerHTML as string;
    const stale = () => (p as any).card.classList.contains("stale") as boolean;

    p.update({ latex: "a + b", caret: 5, display: false, rect });
    expect(html()).toContain("<math");
    p.update({ latex: "a + \\frac{b}{", caret: 13, display: false, rect }); // half-typed: keep, dimmed
    expect(html()).toContain("<math");
    expect(stale()).toBe(true);
    p.update(null); // left the formula
    p.update({ latex: "\\frac{c}{", caret: 9, display: false, rect }); // another, half-typed formula
    expect(html()).toBe("");
    expect(p.visible).toBe(false);
  });
});
