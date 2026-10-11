import { describe, expect, it } from "vitest";
import { fixCaretMark, prepareLatex } from "../../src/preview/preview";
import { alignColumns, renderMath } from "../../src/shared/math";

const A = "#4fb8aa";
const MARK = `{\\color{${A}}\\rule{0.0901em}{1em}}`;
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

  it("keeps the mark out of a command's argument list", () => {
    expect(prep("\\frac|{1}{2}").withCaret).toBe(`\\frac{${MARK}1}{2}`);
    expect(prep("\\frac{1}|{2}").withCaret).toBe(`\\frac{1}{${MARK}2}`);
    expect(prep("x^|{2}").withCaret).toBe(`x^{${MARK}2}`);
  });

  it("leaves empty groups alone without an accent (finished formulas)", () => {
    expect(prepareLatex({ latex: "{}^{14}C", caret: 0 }, "").plain).toBe("{}^{14}C");
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

describe("alignment in Chrome's MathML", () => {
  it("turns columnalign into text-align on each cell", () => {
    const html = renderMath("\\begin{aligned}&a\\\\&=f\\end{aligned}", true)!;
    // aligned: no gap between the columns (=& a is "=a", like LaTeX), 0.25em between rows
    const count = (s: string) => html.split(s).length - 1;
    expect(count('<mtd style="padding:calc(0.125em + 0.15em) 0em calc(0.125em + 0.15em) 0;text-align:right">')).toBe(2);
    expect(count('<mtd style="padding:calc(0.125em + 0.15em) 0em calc(0.125em + 0.15em) 0em;text-align:left">')).toBe(2);
  });

  it("restarts the columns on each row and nested table", () => {
    const out = alignColumns('<mtable columnalign="right left"><mtr><mtd>a</mtd><mtd><mtable columnalign="center"><mtr><mtd>x</mtd></mtr></mtable></mtd></mtr><mtr><mtd>b</mtd></mtr></mtable>');
    const cells = [...out.matchAll(/<mtd style="([^"]*)">(\w)/g)].map((m) => `${m[2]} ${m[1]}`);
    expect(cells).toEqual([
      "a padding:calc(0.5ex + 0.15em) 0.4em calc(0.5ex + 0.15em) 0;text-align:right",
      "x padding:calc(0.5ex + 0.15em) 0.4em calc(0.5ex + 0.15em) 0",
      "b padding:calc(0.5ex + 0.15em) 0.4em calc(0.5ex + 0.15em) 0;text-align:right",
    ]);
    expect(out).toContain('<mtd style="padding:calc(0.5ex + 0.15em) 0.4em calc(0.5ex + 0.15em) 0.4em;text-align:left"><mtable');
  });

  it("keeps alignat's column count in an alignedat wrapper", () => {
    const p = prepareLatex({ latex: "{2}a&=b&c&=d", caret: 1, env: "alignat" }, A);
    expect(p.plain).toBe("\\begin{alignedat}{2}a&=b&c&=d\\end{alignedat}");
    expect(renderMath(p.withCaret!, true)).not.toBeNull();
  });

  it("drops the caret mark below the baseline", () => {
    const html = fixCaretMark(renderMath(prep("x+|").withCaret!)!);
    expect(html).toContain('width="0.09em" height="0.8em" depth="0.25em"');
    expect(html).not.toContain("<mpadded");
  });
});
