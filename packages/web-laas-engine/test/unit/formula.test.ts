import { describe, expect, it } from "vitest";
import { formulaAt } from "../../src/core/formula";

/** "|" marks the caret; returns the formula with the caret re-inserted */
const at = (s: string) => {
  const i = s.indexOf("|");
  const f = formulaAt(s.slice(0, i), s.slice(i + 1));
  return f && { tex: f.latex.slice(0, f.caret) + "|" + f.latex.slice(f.caret), display: f.display, env: f.env };
};

describe("formulaAt", () => {
  it.each([
    ["a $x + |y$ b", "x + |y", false],
    ["$$\\sum_{i|}^{n}$$ ok", "\\sum_{i|}^{n}", true],
    ["\\( a| \\) b", " a| ", false],
    ["\\[ \\frac{a}{|} \\] c", " \\frac{a}{|} ", true],
    ["text $a$ and $b|c$ end", "b|c", false],
    ["$ \\$5 + |x$", " \\$5 + |x", false],
    ["$x|", "x|", false], // unclosed: up to the end
  ])("%j → %j", (src, tex, display) => {
    expect(at(src)).toMatchObject({ tex, display });
  });

  it("environments", () => {
    expect(at("\\begin{align} a &= |b \\\\ c &= d \\end{align}")).toEqual({
      tex: " a &= |b \\\\ c &= d ",
      display: true,
      env: "align",
    });
  });

  it("stops an unclosed formula at a blank line", () => {
    expect(at("$x + |y\n\nnext paragraph")?.tex).toBe("x + |y");
  });

  it("is null outside math and inside \\text{}", () => {
    expect(at("plain |text")).toBeNull();
    expect(at("$a$ |b")).toBeNull();
    expect(at("$\\text{wo|rd}$")).toBeNull();
  });
});
