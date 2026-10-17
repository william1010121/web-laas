import { describe, expect, it } from "vitest";
import { findFormulas, formulaAt } from "../../src/core/formula";

/** "|" marks the caret; returns the formula with the caret re-inserted */
const at = (s: string, opts?: { comments?: boolean }) => {
  const i = s.indexOf("|");
  const f = formulaAt(s.slice(0, i), s.slice(i + 1), opts);
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

  it("skips delimiters inside % comments when comments are on (Overleaf)", () => {
    const src = "$x + | % $ not the end\n + y$ after";
    const i = src.indexOf("|");
    const before = src.slice(0, i);
    const after = src.slice(i + 1);
    expect(formulaAt(before, after, { comments: true })?.latex).toBe("x +  % $ not the end\n + y");
    expect(formulaAt(before, after)?.latex).toBe("x +  % "); // elsewhere % is plain text
    expect(formulaAt("$a + ", "\\% b$")?.latex).toBe("a + \\% b"); // \% is not a comment
  });

  it("skips nested math inside \\text{} after the caret", () => {
    expect(at("$a + |\\text{if $x>0$} + b$ end")?.tex).toBe("a + |\\text{if $x>0$} + b");
  });

  it("does not close at a \\\\ followed by the closer character", () => {
    expect(at("\\(a + | \\\\) + b \\) end")?.tex).toBe("a + | \\\\) + b ");
  });

  it("skips % comments inside a \\text{} group (Overleaf)", () => {
    expect(at("$a + |\\text{foo % } $ ignored\nbar} + b$ end", { comments: true })?.tex).toBe(
      "a + |\\text{foo % } $ ignored\nbar} + b",
    );
  });

  it("accepts spaces in \\end {env}", () => {
    expect(at("\\begin {align} a &= |b \\end {align} trailing")?.tex).toBe(" a &= |b ");
  });

  it("no formula while the caret sits in a % comment (Overleaf)", () => {
    expect(at("$x + % note | $ ignored\n + y$", { comments: true })).toBeNull();
    expect(at("$x + 50\\% |y$", { comments: true })?.tex).toBe("x + 50\\% |y"); // \% is a percent sign
  });

  it("xalignat and xxalignat are math", () => {
    expect(at("\\begin{xalignat}{2} a&=|b \\end{xalignat}")?.env).toBe("xalignat");
    expect(at("\\begin{xxalignat}{2} a&=|b \\end{xxalignat}")?.env).toBe("xxalignat");
  });

  it("an earlier paragraph's open $ doesn't hide this paragraph's formula", () => {
    expect(at("$draft\n\nnow $x|$")?.tex).toBe("x|");
  });

  it("ignores an opener left open in an earlier paragraph", () => {
    expect(at("$x\n\nplain |text")).toBeNull();
  });

  it("does not borrow a closer from the next paragraph", () => {
    expect(at("$x + |y\n\nnext $z$")?.tex).toBe("x + |y");
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

describe("findFormulas", () => {
  const spans = (s: string, opts?: { comments?: boolean }) =>
    findFormulas(s, opts).map((f) => [s.slice(f.from, f.to), f.latex, f.display, f.env]);

  it("finds every kind of delimiter", () => {
    const s = "a $x$ b \\(y\\) $$z$$ \\[w\\]\n\\begin{align*}\na &= b\n\\end {align*} \\begin{math}m\\end{math}";
    expect(spans(s)).toEqual([
      ["$x$", "x", false, undefined],
      ["\\(y\\)", "y", false, undefined],
      ["$$z$$", "z", true, undefined],
      ["\\[w\\]", "w", true, undefined],
      ["\\begin{align*}\na &= b\n\\end {align*}", "\na &= b\n", true, "align*"],
      ["\\begin{math}m\\end{math}", "m", false, "math"],
    ]);
  });

  it("skips escapes, non-math environments and unclosed openers", () => {
    expect(spans("\\$5 \\\\ \\begin{itemize} $a$ \\end{itemize}")).toEqual([["$a$", "a", false, undefined]]);
    expect(spans("open $a\n\nnext $b$")).toEqual([["$b$", "b", false, undefined]]);
    expect(spans("$$\n\n$$")).toEqual([]);
  });

  it("Markdown: prices stay text, code spans are skipped", () => {
    expect(spans("costs $5 and $10 today")).toEqual([]);
    expect(spans("$ x$ and $5 or $y $ z")).toEqual([]);
    expect(spans("a $x$, $y$.")).toHaveLength(2);
    expect(spans("costs $10.\nThen $a^2$ ok")).toEqual([["$a^2$", "a^2", false, undefined]]);
    expect(spans("$a\nb$", { comments: true })).toHaveLength(1); // LaTeX allows it
    expect(spans("`$a$` and ``x ` $b$`` then $c$")).toEqual([["$c$", "c", false, undefined]]);
  });

  it("Markdown: LaTeX may have a space inside its $, or run over a line", () => {
    // laas's auto space after \alpha lands right before the closer
    expect(spans("so $\\alpha $ and $ x_1$")).toEqual([
      ["$\\alpha $", "\\alpha ", false, undefined],
      ["$ x_1$", " x_1", false, undefined],
    ]);
    expect(spans("a $\\frac{1}\n{2}$ b")).toEqual([["$\\frac{1}\n{2}$", "\\frac{1}\n{2}", false, undefined]]);
    // but not plain words, nor prices, nor past a blank line
    expect(spans("$a\nb$")).toEqual([]);
    expect(spans("$ x $")).toEqual([]);
    expect(spans("costs $5 and\n$x^2$ more")).toEqual([["$x^2$", "x^2", false, undefined]]);
    expect(spans("pay $5 for x_1 and $10")).toEqual([]);
    expect(spans("$\\alpha\n\nb$")).toEqual([]);
    expect(spans("use $HOME and\n$\\alpha$")).toEqual([["$\\alpha$", "\\alpha", false, undefined]]);
  });

  it("LaTeX: comments hide delimiters, $ x $ is math", () => {
    expect(spans("% $a$\n$ b $", { comments: true })).toEqual([["$ b $", " b ", false, undefined]]);
    expect(spans("$x$ % $y$", { comments: true })).toEqual([["$x$", "x", false, undefined]]);
  });

  it("text arguments inside math don't end it", () => {
    expect(spans("$a \\text{ $b$ } c$ d")).toEqual([["$a \\text{ $b$ } c$", "a \\text{ $b$ } c", false, undefined]]);
  });

  it("$x$$y$ is two formulas", () => {
    expect(spans("$x$$y$").map((f) => f[1])).toEqual(["x", "y"]);
  });
});

describe("findFormulas on long text", () => {
  it("handles a long run without blank lines (each paragraph scanned once)", () => {
    const line = "a $x_1$ and $$\\sum_k k$$ b \\(y\\)\n";
    const text = line.repeat(20000);
    const t = performance.now();
    const fs = findFormulas(text, { comments: true });
    expect(fs).toHaveLength(60000);
    expect(fs[59999].latex).toBe("y");
    // linear: well under a second for 700k characters (it was minutes when quadratic)
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it("walks a long run of backslashes once, and still pairs escapes", () => {
    const run = "\\".repeat(200000); // 200k backslashes: \\ pairs, so the $ after them closes
    const t = performance.now();
    const fs = findFormulas(`$a${run}$ b \\(c${run}\\) \\(d\\${run}\\) e`, { comments: true });
    expect(performance.now() - t).toBeLessThan(500);
    // the second \( is never closed: its \) is preceded by an even run, so the ) is escaped
    expect(fs.map((f) => f.latex.length)).toEqual([run.length + 1, run.length + 1]);
    // an odd run escapes what follows
    expect(findFormulas(`$a\\\\\\$ b$`, { comments: true }).map((f) => f.latex)).toEqual(["a\\\\\\$ b"]);
  });
});

describe("findFormulas edge cases", () => {
  const latex = (s: string, comments = true) => findFormulas(s, { comments }).map((f) => f.latex);

  it("an escaped percent is text, not a comment", () => {
    expect(latex("50\\% and $x$")).toEqual(["x"]);
    expect(latex("a \\\\% comment $no$\n$y$")).toEqual(["y"]); // \\ is a line break: this % does comment
  });

  it("a code span closes only on a run of as many backticks", () => {
    expect(latex("`a ``` $x$ b` then $y$", false)).toEqual(["y"]);
    expect(latex("``a ` $x$ ``  $y$", false)).toEqual(["y"]);
  });

  it("a fenced code block is skipped to its closing fence, blank lines and all", () => {
    expect(latex("```tex\n$a$\n\n$b$\n```\n$c$", false)).toEqual(["c"]);
    expect(latex("  ~~~~\n$a$\n~~~\n$b$\n~~~~\n$c$", false)).toEqual(["c"]); // a shorter fence doesn't close it
    expect(latex("````\n$a$\n\n", false)).toEqual([]); // unclosed: to the end
    expect(latex("text ``` $a$ ``` $b$", false)).toEqual(["b"]); // mid-line: an inline code span
    expect(latex("```\n$a$\n```\n$b$", true)).toEqual(["a", "b"]); // LaTeX has no fences
    expect(latex("```foo``` and $x$\nthen $y$", false)).toEqual(["x", "y"]); // backticks after: inline code
    expect(latex("~~~ a`b\n$a$\n~~~\n$c$", false)).toEqual(["c"]); // a tilde fence's info may have them
  });

  it("an indented code block (after a blank line) holds no math", () => {
    expect(latex("text\n\n    $a$ code\n\tmore $b$\n\n    $c$\nafter $d$", false)).toEqual(["d"]);
    expect(latex("    $a$\n$b$", false)).toEqual(["b"]); // at the very start too
    expect(latex("para\n    $a$ continues it", false)).toEqual(["a"]); // can't interrupt a paragraph
    expect(latex("\n\n    $a$", true)).toEqual(["a"]); // LaTeX: indentation means nothing
  });

  it("an empty pair is passed over, closer and all", () => {
    expect(latex("$ $ and $x$")).toEqual(["x"]);
    expect(latex("$$  $$ then $$y$$")).toEqual(["y"]);
  });
});

describe("the formula open where CodeMirror's drawn lines resume", async () => {
  const { openAt } = await import("../../src/dom/adapters/codemirror");
  const open = (text: string, pos: number, comments = true) =>
    openAt({}, 1, (a, b) => text.slice(a, b), text.length, pos, comments);

  it("reads back to the paragraph's real start, however far", () => {
    const text = "intro\n\n$" + "a".repeat(30000) + "$ after";
    expect(open(text, 25000)).toBe(text.slice(7, 25000)); // from the opener, 25k back
    expect(open(text, text.length - 3)).toBe(""); // past its closer
  });

  it("finds paragraph bounds across read chunks", () => {
    const text = "x".repeat(100000) + "\n\n" + "y".repeat(50000) + "$$" + "z".repeat(40000) + "$$\n\n$w$";
    const opener = 100002 + 50000;
    expect(open(text, opener + 30000)).toBe(text.slice(opener, opener + 30000));
    expect(open(text, opener - 10)).toBe("");
  });

  it("text outside any formula needs nothing", () => {
    expect(open("$a$ then text and $b$", 8)).toBe("");
  });

  it("a paragraph starting right at pos ends at its own blank line, not the one before", () => {
    const text = "a\n\n$x y$ b\n\nc";
    const reads: [number, number][] = [];
    const read = (a: number, b: number) => (reads.push([a, b]), text.slice(a, b));
    const key = {};
    expect(openAt(key, 1, read, text.length, 3, true)).toBe("");
    expect(reads.at(-1)).toEqual([3, 10]); // the paragraph "$x y$ b"
    expect(openAt(key, 1, read, text.length, 5, true)).toBe("$x"); // from the cache
  });

  it("\\verb bodies are literal text", () => {
    const latex = (s: string) => findFormulas(s, { comments: true }).map((f) => f.latex);
    expect(latex("\\verb|$not_math$| and $x$")).toEqual(["x"]);
    expect(latex("\\verb*+$a$+ \\verb!b! $y$")).toEqual(["y"]);
    expect(latex("\\verb**$not$* and $w$")).toEqual(["w"]);
    // unclosed on its line: just the command
    expect(latex("\\verb|a\n$z$")).toEqual(["z"]);
  });

  it("an indented code block may start with spaces then a tab", () => {
    const latex = (s: string) => findFormulas(s, { comments: false }).map((f) => f.latex);
    expect(latex("a\n\n \t$not$\n  \t$no$\n\n$x$")).toEqual(["x"]);
    expect(latex("a\n\n   $y$")).toEqual(["y"]); // 3 spaces: not code
  });

  it("verbatim-style environments are literal text", () => {
    const latex = (s: string) => findFormulas(s, { comments: true }).map((f) => f.latex);
    expect(latex("\\begin{verbatim}\n$not$\n\n$math$\n\\end{verbatim} $x$")).toEqual(["x"]);
    expect(latex("\\begin{lstlisting}[language=TeX]\n\\[a\\]\n\\end {lstlisting}\n\\[y\\]")).toEqual(["y"]);
    expect(latex("\\begin{minted}{tex}\n$a$\n\\end{minted}$b$ \\begin{verbatim*}$c$\\end{verbatim*}")).toEqual(["b"]);
  });
});
