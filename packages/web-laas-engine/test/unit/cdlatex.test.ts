import { describe, expect, it } from "vitest";
import { cdlatexBackTab, cdlatexTab } from "../../src/core/cdlatex";

/** "|" marks the caret before and after one Tab. */
function tab(s: string, simplify = true) {
  const pos = s.indexOf("|");
  const text = s.slice(0, pos) + s.slice(pos + 1);
  const m = cdlatexTab(text, pos, { simplify });
  let out = text;
  if (m.edit) out = out.slice(0, m.edit.from) + m.edit.insert + out.slice(m.edit.to);
  return out.slice(0, m.to) + "|" + out.slice(m.to);
}

describe("cdlatexTab (cdlatex-tab movement)", () => {
  it.each([
    // into the next empty group
    ["\\frac{a|}{}", "\\frac{a}{|}"],
    ["\\frac{|}{}", "\\frac{}{|}"],
    // out of a group, stopping after it
    ["\\sqrt{x|} + 1", "\\sqrt{x}| + 1"],
    ["\\sqrt{x|}$ ok", "\\sqrt{x}|$ ok"],
    // past $
    ["$x+y|$ ok", "$x+y$| ok"],
    ["$$x|$$", "$$x$$|"],
    // a group followed by ^ _ { ( keeps going (and _{i} is simplified to _i)
    ["\\sum_{i|}^{} x", "\\sum_i^{|} x"],
    ["\\sum_{ij|}^{} x", "\\sum_{ij}^{|} x"],
    // spaces and line ends
    ["a| + b", "a + |b"],
    ["abc|def ghi", "abcdef |ghi"],
    ["abc|def\nghi", "abcdef|\nghi"],
    ["a \\\\|\nb c", "a \\\\\nb |c"],
    // on a closing bracket: step over it; inside the search, stop before a
    // closing bracket that follows a bracket (an empty group)
    ["f(|) + 1", "f()| + 1"],
    ["g(|x)(), y", "g(x)(|), y"],
  ])("%j → %j", (from, to) => expect(tab(from)).toBe(to));

  it("simplifies one-character scripts when leaving them", () => {
    expect(tab("x_{2|} + y")).toBe("x_2| + y");
    expect(tab("x^{n|}")).toBe("x^n|");
    expect(tab("x_{12|} + y")).toBe("x_{12}| + y");
    expect(tab("x_{2|} + y", false)).toBe("x_{2}| + y");
  });

  it("stays at the end of the text", () => expect(tab("abc|")).toBe("abc|"));
});

describe("cdlatexBackTab (Shift+Tab)", () => {
  const back = (s: string) => {
    const pos = s.indexOf("|");
    const text = s.slice(0, pos) + s.slice(pos + 1);
    const to = cdlatexBackTab(text, pos, 0);
    return text.slice(0, to) + "|" + text.slice(to);
  };
  it.each([
    ["\\frac{x}{y}|", "\\frac{x}{y|}"],
    ["\\frac{x}{y|}", "\\frac{x|}{y}"],
    ["\\frac{x|}{y}", "|\\frac{x}{y}"],
    ["\\sqrt{x} + |b", "\\sqrt{x}| + b"],
    ["\\sqrt{x}| + b", "\\sqrt{x|} + b"],
    ["a + b|", "a + |b"],
  ])("%j → %j", (from, to) => expect(back(from)).toBe(to));

  it("never skips a stop Tab visits", () => {
    const text = "\\frac{a}{b} + \\sqrt{x}";
    const stops: number[] = [];
    for (let p = 0; ; ) {
      const to = cdlatexTab(text, p, { simplify: false }).to;
      if (to <= p) break;
      stops.push((p = to));
    }
    // Shift+Tab may also stop inside a group's end, but never jumps past the previous Tab stop
    for (let i = stops.length - 1; i > 0; i--) {
      const b = cdlatexBackTab(text, stops[i], 0);
      expect(b).toBeGreaterThanOrEqual(stops[i - 1]);
      expect(b).toBeLessThan(stops[i]);
    }
  });
});
