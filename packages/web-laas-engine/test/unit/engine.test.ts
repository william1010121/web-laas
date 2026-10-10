import { describe, expect, it } from "vitest";
import { compileConfig, resolveMathDelimiters, snippetsForHost } from "../../src/core/config";
import { cheatsheetEntries, groupCheatsheet } from "../../src/core/cheatsheet";
import { findExpansion } from "../../src/core/matcher";
import { parseConfigText } from "../../src/core/parser";
import { mathContext, objectStart } from "../../src/core/tex";

const snippets = (host = "example.com", text: string | null = null) =>
  snippetsForHost(compileConfig(text).config, host);

/** Simulate typing: returns [text, caret] after applying the expansion, if any. */
function expand(before: string, host = "example.com", text: string | null = null) {
  const exp = findExpansion(snippets(host, text), before, { auto: true });
  if (!exp) return null;
  const out = before.slice(0, exp.from) + exp.rendered.text;
  const caret = exp.from + exp.rendered.stops[0].start;
  return out.slice(0, caret) + "|" + out.slice(caret);
}

describe("parser", () => {
  it("parses the object-literal subset", () => {
    const v = parseConfigText(`{
      // comment
      a: 'x\\ny', "b": [1, 2.5, true, null,], c: /a\\/b[/]/i, d: \`\\frac{$1}\`, /* c */
    }`) as any;
    expect(v.a).toBe("x\ny");
    expect(v.b).toEqual([1, 2.5, true, null]);
    expect(v.c).toBeInstanceOf(RegExp);
    expect(v.c.source).toBe("a\\/b[/]");
    expect(v.d).toBe("\\frac{$1}");
  });
  it("reports positions", () => {
    expect(() => parseConfigText("{ a: 1,\n b: }")).toThrow(/line 2/);
  });
  it("compiles the built-ins without issues", () => {
    const { issues, config } = compileConfig(null);
    expect(issues).toEqual([]);
    // without cdlatex, laas keeps its own ' accents
    const laasOnly = compileConfig(null, { cdlatex: false }).config.snippets;
    expect(laasOnly.filter((s) => s.source === "laas").length).toBeGreaterThan(200);
    expect(config.snippets.filter((s) => s.source === "cdlatex").length).toBeGreaterThan(150);
  });
});

describe("math context", () => {
  it.each([
    ["a $x", true],
    ["a $x$ b", false],
    ["$$ x", true],
    ["\\( x", true],
    ["\\[ x \\] y", false],
    ["\\begin{align} x", true],
    ["\\begin{align} x \\end{align}", false],
    ["$ \\text{hi ", false],
    ["$ \\text{hi } x", true],
    ["$ \\text{a $b", true],
    ["\\$ x", false],
    ["$x^{2", true],
  ])("%j → %s", (t, m) => expect(mathContext(t).math).toBe(m));
  it("handles comments only when asked", () => {
    expect(mathContext("% $\nx", { comments: true }).math).toBe(false);
    expect(mathContext("% $\nx").math).toBe(true);
  });
});

describe("objectStart (laas-identify-adjacent-tex-object)", () => {
  it.each([
    ["a + x", "x"],
    ["a + x^2", "x^2"],
    ["a + (b+c)", "(b+c)"],
    ["a + \\frac{1}{2}", "\\frac{1}{2}"],
    ["a + f(x)", "(x)"],
    ["a + \\alpha", "\\alpha"],
    ["a + a_{ij}^{2}", "a_{ij}^{2}"],
    ["a + 3.14", "3.14"],
    ["a + \\hat{x}_1", "\\hat{x}_1"],
  ])("%j → %j", (t, o) => expect(t.slice(objectStart(t, t.length)!)).toBe(o));
  it("returns null without object", () => expect(objectStart("a + ", 4)).toBeNull());
});

describe("laas defaults", () => {
  it.each([
    // basic
    ["$x->", "$x\\to|"],
    ["$a <=", "$a \\leq|"],
    ["$a<>", "$a\\diamond|"],
    ["$x sr", "$x ^2|"],
    ["$a inn", "$a \\in|"],
    ["$ eqv", "$ \\equiv|"],
    ["$xsin", "$x\\sin|"],
    ["$arcsin", "$\\arcsin|"],
    // ; family: longest key wins
    ["$;a", "$\\alpha|"],
    ["$;e", "$\\epsilon|"],
    ["$;;e", "$\\varepsilon|"],
    ["$;;;e", "$\\exp|"],
    ["$;i", "$\\in|"],
    ["$;I", "$\\iota|"],
    ["$;w", "$\\xi|"],
    ["$;\\", "$\\setminus|"],
    // blackboard bold (web output)
    ["$x RR", "$x \\mathbb{R}|"],
    // subscripts
    ["$a1", "$a_1|"],
    ["$a_12", "$a_{12}|"],
    ["$x^23", "$x^{23}|"],
    ["$xii", "$x_i|"],
    ["$xnn", "$x_n|"],
    ["$xip1", "$x_{i+1}|"],
    ["$xkm1", "$x_{k-1}|"],
    // fraction
    ["$x/", "$\\frac{x}{|}"],
    ["$(a+b)/", "$\\frac{a+b}{|}"],
    ["$ //", "$ \\frac{|}{}"],
    ["$\\alpha_1/", "$\\frac{\\alpha_1}{|}"],
    // accents
    ["$x'.", "$\\dot{x}|"],
    ["$x'r", "$\\mathrm{x}|"],
    ["$x'0", "${\\textstyle x}|"],
    ["$x.. ", "$\\dot{x} |"],
    ["$x,.", "$\\vec{x}|"],
    ["$xhat", "$\\hat{x}|"],
    ["$xbar", "$\\overline{x}|"],
  ])("%j → %j", (t, r) => expect(expand(t)).toBe(r));

  it.each([
    "x sr", // text mode
    "$\\;a", // right after a backslash
    "$\\sum", // inside a \command
    "$x'", // nothing yet
    "$ /", // no object
    "$abc1", // subscript needs a single letter
    "$\\text{x sr", // \text inside math
    "they'r", // text-mode accents only on Overleaf
  ])("%j does not expand", (t) => expect(expand(t)).toBeNull());

  it("inn beats the nn subscript", () => expect(expand("$inn")).toBe("$\\in|"));
  it("text-mode accents on Overleaf", () => expect(expand("word'b", "www.overleaf.com")).toBe("\\textbf{word}|"));
  it("\\CC macros on Overleaf", () => expect(expand("$CC", "www.overleaf.com")).toBe("$\\CC|"));

  it("marks plain backslash expansions for auto-space", () => {
    const s = snippets();
    expect(findExpansion(s, "$;a", { auto: true })!.autoSpace).toBe(true);
    expect(findExpansion(s, "$sr", { auto: true })!.autoSpace).toBe(false);
    expect(findExpansion(s, "$x/", { auto: true })!.autoSpace).toBe(false);
    expect(findExpansion(s, "$x'.", { auto: true })!.autoSpace).toBe(false);
  });
});

describe("web extras", () => {
  it.each([
    ["see mk", "see $|$"],
    ["$sum", "$\\sum_{|}^{} "],
  ])("%j → %j", (t, r) => expect(expand(t)).toBe(r));

  it("mk leaves a tabstop after the closing $", () => {
    const exp = findExpansion(snippets(), "mk", { auto: true })!;
    expect(exp.rendered.text).toBe("$$");
    expect(exp.rendered.stops).toEqual([{ start: 1, end: 1 }, { start: 2, end: 2 }]);
  });

  it("site-specific dm", () => {
    expect(expand("dm", "www.overleaf.com")).toBe("\\[\n\t|\n\\]");
    expect(expand("dm", "chatgpt.com")).toBe("$$\n|\n$$");
  });

  it("can be turned off", () => {
    const s = snippetsForHost(compileConfig(null, { extras: false }).config, "x");
    expect(findExpansion(s, "mk", { auto: true })).toBeNull();
    expect(findExpansion(s, "$;a", { auto: true })).not.toBeNull();
  });
});

describe("user config", () => {
  it("overrides, extends and removes defaults", () => {
    const cfg = `{
      removeDefaults: ["sr"],
      snippets: [
        { trigger: ";a", replacement: "\\\\aleph", options: "mA" },
        { trigger: /([a-z])tld/, replacement: "\\\\tilde{[[0]]}", options: "mA" },
        { trigger: "beg", replacement: "\\\\begin{$1}\\n$0\\n\\\\end{$1}", options: "tA" },
      ],
    }`;
    expect(expand("$;a", "x", cfg)).toBe("$\\aleph|");
    expect(expand("$xtld", "x", cfg)).toBe("$\\tilde{x}|");
    expect(expand("$x sr", "x", cfg)).toBeNull();
    expect(expand("beg", "x", cfg)).toBe("\\begin{|}\n\n\\end{}");
  });

  it("groups pass options and sites down", () => {
    const cfg = `[{ group: "Mine", options: "mA", sites: ["a.com"], snippets: [
      { trigger: "qq", replacement: "\\\\quad" },
      { trigger: "zz", replacement: "Z", options: "tA" },
    ] }]`;
    const all = compileConfig(cfg).config.snippets.filter((s) => s.source === "user");
    expect(all.map((s) => [s.key, s.group, s.mode.text, s.sites])).toEqual([
      ["qq", "Mine", false, ["a.com"]],
      ["zz", "Mine", true, ["a.com"]],
    ]);
    expect(expand("$qq", "a.com", cfg)).toBe("$\\quad|");
    expect(expand("$qq", "b.com", cfg)).toBeNull();
  });

  it("tab-triggered (non-auto) snippets", () => {
    const cfg = `[{ trigger: "fig", replacement: "\\\\begin{figure}$0\\\\end{figure}", options: "t" }]`;
    const s = snippetsForHost(compileConfig(cfg).config, "x");
    expect(findExpansion(s, "fig", { auto: true })).toBeNull();
    expect(findExpansion(s, "fig", { auto: false })?.rendered.text).toBe("\\begin{figure}\\end{figure}");
  });
});

describe("cdlatex", () => {
  const tabExpand = (before: string, host = "example.com") => {
    const exp = findExpansion(snippets(host), before, { auto: false });
    if (!exp) return null;
    const out = before.slice(0, exp.from) + exp.rendered.text;
    const caret = exp.from + exp.rendered.stops[0].start;
    return out.slice(0, caret) + "|" + out.slice(caret);
  };

  it.each([
    // ` math symbols, by level
    ["$`a", "$\\alpha|"],
    ["$``A", "$\\aleph|"],
    ["$``e", "$\\varepsilon|"],
    ["$```e", "$\\exp|"],
    ["$```G", "$10^{|}"],
    // ' modify: only the last letter in math, whole macros and groups
    ["$ab'.", "$a\\dot{b}|"],
    ["$\\alpha'.", "$\\dot{\\alpha}|"],
    ["$x^{ab}'.", "$x^\\dot{ab}|"],
    ["$ '.", "$ \\dot{|}"],
    ["$x'b", "$\\mathbf{x}|"],
    ["$i'.", "$\\dot{\\imath}|"],
    ["$x'0", "${\\textstyle x}|"],
    ["$ '(", "$ \\left( | \\right)"],
    // on their own (nothing to modify on the left): an empty form
    ["$a+'b", "$a+\\mathbf{|}"],
    ["$'m", "$\\mbox{|}"],
    ["$x='.", "$x=\\dot{|}"],
    ["$x^'b", "$x^\\mathbf{|}"],
    ["$2'b", "$\\mathbf{2}|"],
    // _ ^ with braces; twice → roman
    ["$x_", "$x_{|}"],
    ["$x^", "$x^{|}"],
    ["$x_{_", "$x_{\\mathrm{|}"],
    // laas keys that cdlatex doesn't take still work
    ["$;a", "$\\alpha|"],
    ["$a1", "$a_1|"],
  ])("%j → %j", (t, r) => expect(expand(t)).toBe(r));

  it("text-mode modify and symbols only on Overleaf", () => {
    expect(expand("they'r")).toBeNull();
    expect(expand("word'b", "www.overleaf.com")).toBe("\\textbf{word}|");
    expect(expand("see `a", "www.overleaf.com")).toBe("see $\\alpha|$");
    expect(expand("see `a")).toBeNull();
  });

  it("Tab commands (with a word boundary)", () => {
    expect(tabExpand("$fr")).toBe("$\\frac{|}{}");
    expect(tabExpand("$lr(")).toBe("$\\left( | \\right)");
    expect(tabExpand("$xfr")).toBeNull();
    expect(tabExpand("$x sq")).toBe("$x \\sqrt{|}");
    expect(tabExpand("equ", "www.overleaf.com")).toBe("\\begin{equation}\n|\n\\end{equation}");
    expect(tabExpand("equ")).toBeNull(); // document commands only on Overleaf
  });

  it("cdlatex can be turned off (laas ' accents come back)", () => {
    const s = snippetsForHost(compileConfig(null, { cdlatex: false }).config, "x");
    const exp = findExpansion(s, "$ab'.", { auto: true })!;
    expect(exp.rendered.text).toBe("\\dot{ab}");
    expect(findExpansion(s, "$x_", { auto: true })).toBeNull();
  });
});

describe("cheat sheet", () => {
  it("derives previews and groups", () => {
    const entries = cheatsheetEntries(snippets());
    const by = (t: string) => entries.find((e) => e.trigger === t)!;
    expect(by(";a").preview).toBe("\\alpha");
    expect(by("//").preview).toBe("\\frac{\\square}{\\square}");
    expect(by("/").preview).toBe("\\frac{x}{\\square}");
    expect(by("'.").preview).toBe("\\dot{x}");
    expect(by("sr").preview).toBe("x^2");
    expect(by("mk").preview).toBeNull();
    expect(by("mk").mode).toBe("text");
    const groups = groupCheatsheet(entries).map((g) => g.group);
    expect(groups[0]).toBe("laas · 基本符號");
    expect(groups).toContain("Web 擴充 · 結構");
  });
});

describe("resolveMathDelimiters", () => {
  it("takes each kind from the most specific site that sets it", () => {
    const sites = { "example.com": { inline: "paren", display: "bracket" }, "chat.example.com": { inline: "auto" } } as const;
    expect(resolveMathDelimiters(sites, "chat.example.com")).toEqual({ inline: "auto", display: "bracket" });
    expect(resolveMathDelimiters(sites, "www.example.com")).toEqual({ inline: "paren", display: "bracket" });
    expect(resolveMathDelimiters(sites, "other.org")).toEqual({ inline: undefined, display: undefined });
  });
});
