// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { LaasController, type EditorAdapter } from "../../src/dom";

/** Simulate the browser inserting a typed character, then the keydown our controller sees. */
function type(el: HTMLTextAreaElement, ch: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
  const p = el.selectionStart;
  el.setRangeText(ch, p, el.selectionEnd, "end");
}
const tick = () => new Promise((r) => setTimeout(r, 5));

let detach: (() => void) | null = null;
afterEach(() => {
  detach?.();
  document.body.innerHTML = "";
});

describe("LaasController", () => {
  it("expands in a textarea and jumps tabstops", async () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.focus();
    detach = new LaasController({ host: "example.com" }).attach();
    for (const ch of " mkx/") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe(" $\\frac{x}{}$");
    type(ta, "y");
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(ta.selectionStart).toBe(" $\\frac{x}{y}".length);
  });

  it("mk / dm insert the delimiters chosen for the site", async () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.focus();
    const c = new LaasController({ host: "chat.example.com" });
    c.setState({
      siteMath: {
        "example.com": { inline: "dollar", display: "equation" },
        "chat.example.com": { inline: "paren" }, // more specific: wins for mk; dm still comes from example.com
        "other.org": { inline: "dollar" },
      },
    });
    detach = c.attach();
    for (const ch of " mkx") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe(" \\(x\\)");
    ta.value = "";
    for (const ch of "dm") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("\\begin{equation*}\n\t\n\\end{equation*}");
    c.setState({ siteMath: { "example.com": { display: "align" } } });
    ta.value = "";
    for (const ch of "dm") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("\\begin{align}\n\t\n\\end{align}");
    c.setState({ siteMath: {} }); // back to the built-in $…$
    ta.value = "";
    for (const ch of "mk") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("$$");
  });

  it("expands synchronously on the input event", () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.focus();
    detach = new LaasController({ host: "example.com" }).attach();
    for (const ch of "mk") {
      type(ta, ch);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(ta.value).toBe("$$");
  });

  it("keeps up when keys arrive faster than timers", async () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.focus();
    detach = new LaasController({ host: "example.com" }).attach();
    for (const ch of " mkx/y") type(ta, ch); // no awaiting between keys
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    type(ta, "+");
    await tick();
    expect(ta.value).toBe(" $\\frac{x}{y}+$");
  });

  it("tab-out jumps past the next closing delimiter in math", () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.value = "a $\\sqrt{x} + (y)$ b";
    ta.focus();
    detach = new LaasController({ host: "example.com" }).attach();
    const tab = () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    ta.setSelectionRange(10, 10); // after "x"
    expect(tab()).toBe(false); // consumed
    expect(ta.selectionStart).toBe(11); // after "}"
    ta.setSelectionRange(16, 16); // after "y"
    tab();
    expect(ta.selectionStart).toBe(17); // after ")"
    tab();
    expect(ta.selectionStart).toBe(18); // after "$"
    expect(tab()).toBe(true); // in text: Tab is left to the page
  });

  it("auto-space is skipped before ) and can be turned off", async () => {
    document.body.innerHTML = "<textarea></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.value = "$()$";
    ta.focus();
    ta.setSelectionRange(2, 2);
    const c = new LaasController({ host: "example.com" });
    detach = c.attach();
    for (const ch of ";a") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("$(\\alpha)$");
    c.setState({ prefs: { autoSpace: false } });
    ta.value = "$";
    ta.setSelectionRange(1, 1);
    for (const ch of ";b") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("$\\beta");
  });

  describe("Tab like Emacs (yasnippet + cdlatex-tab)", () => {
    let ta: HTMLTextAreaElement;
    const show = () => ta.value.slice(0, ta.selectionStart) + "|" + ta.value.slice(ta.selectionEnd);
    const tab = (shift = false) =>
      !ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true }));
    const typeAll = async (s: string) => {
      for (const ch of s) {
        type(ta, ch);
        await tick();
      }
    };
    const key = (k: string) => ta.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    const backspace = () => {
      key("Backspace");
      const p = ta.selectionStart;
      ta.setRangeText("", p - 1, p, "end");
    };
    const setup = (value = "") => {
      document.body.innerHTML = "<textarea></textarea>";
      ta = document.querySelector("textarea")!;
      ta.value = value;
      ta.focus();
      ta.setSelectionRange(value.length, value.length);
      detach = new LaasController({ host: "example.com" }).attach();
    };

    it("nested snippets: inner fields, inner exit, then the outer fields", async () => {
      setup();
      await typeAll("mksuma/b");
      expect(show()).toBe("$\\sum_{\\frac{a}{b|}}^{} $");
      tab(); // last field of \frac → its exit
      expect(show()).toBe("$\\sum_{\\frac{a}{b}|}^{} $");
      tab(); // end of \sum's first field → its second field
      expect(show()).toBe("$\\sum_{\\frac{a}{b}}^{|} $");
      await typeAll("n");
      tab(); // \sum's exit
      expect(show()).toBe("$\\sum_{\\frac{a}{b}}^{n} |$");
      await typeAll("x");
      tab(); // mk's exit: out of the math
      expect(show()).toBe("$\\sum_{\\frac{a}{b}}^{n} x$|");
    });

    it("Shift+Tab goes back a field, and stays in the first one", async () => {
      setup();
      await typeAll("mksumi");
      tab();
      expect(show()).toBe("$\\sum_{i}^{|} $");
      tab(true);
      expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("i"); // field selected
      expect(tab(true)).toBe(true); // first field: consumed, nothing moves
      expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("i");
    });

    it("Shift+Tab inside a field steps back through it before changing field", async () => {
      setup();
      await typeAll("mk\\frac{a}{b}");
      expect(show()).toBe("$\\frac{a}{b}|$");
      tab(true);
      expect(show()).toBe("$\\frac{a}{b|}$");
      tab(true);
      expect(show()).toBe("$\\frac{a|}{b}$");
      tab(true);
      expect(show()).toBe("$|\\frac{a}{b}$"); // start of mk's field
      expect(tab(true)).toBe(true); // stays
    });

    it("inside a field, Tab leaves your own brackets first (never past the field)", async () => {
      setup();
      await typeAll("mk\\sqrt{x}");
      ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1); // before the }
      key("ArrowLeft");
      expect(show()).toBe("$\\sqrt{x|}$");
      tab();
      expect(show()).toBe("$\\sqrt{x}|$"); // clamped to the end of mk's field
      tab();
      expect(show()).toBe("$\\sqrt{x}$|");
    });

    it("tracks edits inside fields", async () => {
      setup();
      await typeAll("mksumi=12");
      backspace();
      await typeAll("0");
      expect(show()).toBe("$\\sum_{i=10|}^{} $");
      tab();
      expect(show()).toBe("$\\sum_{i=10}^{|} $");
    });

    it("leaving the field ends the snippet", async () => {
      setup("note: ");
      await typeAll("mksum");
      ta.setSelectionRange(0, 0);
      key("ArrowLeft");
      expect(tab()).toBe(false); // text mode, no snippet: Tab is left to the page
    });

    it("outside snippets in math: into the next empty group, simplifying scripts", () => {
      setup("$\\frac{a}{} + x_{2}$");
      ta.setSelectionRange(8, 8); // after "a"
      tab();
      expect(show()).toBe("$\\frac{a}{|} + x_{2}$");
      ta.setSelectionRange(18, 18); // after "2"
      tab();
      expect(show()).toBe("$\\frac{a}{} + x_2|$");
    });
  });

  describe("cdlatex in the editor", () => {
    let ta: HTMLTextAreaElement;
    const show = () => ta.value.slice(0, ta.selectionStart) + "|" + ta.value.slice(ta.selectionEnd);
    const typeAll = async (str: string) => {
      for (const ch of str) {
        type(ta, ch);
        await tick();
      }
    };
    const tab = () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    const setup = (host = "example.com", value = "") => {
      detach?.();
      document.body.innerHTML = "<textarea></textarea>";
      ta = document.querySelector("textarea")!;
      ta.value = value;
      ta.focus();
      ta.setSelectionRange(value.length, value.length);
      detach = new LaasController({ host }).attach();
    };

    it("$ pairs in text and steps over the closer in math", async () => {
      setup();
      await typeAll("a $");
      expect(show()).toBe("a $|$");
      await typeAll("x$");
      expect(show()).toBe("a $x$|");
      await typeAll(" \\$");
      expect(show()).toBe("a $x$ \\$|"); // escaped: no pair
    });

    it("{ [ pair inside math only (everywhere on Overleaf)", async () => {
      setup();
      await typeAll("{ $\\sqrt{");
      expect(show()).toBe("{ $\\sqrt{|}$");
      setup("www.overleaf.com");
      await typeAll("\\textbf{");
      expect(show()).toBe("\\textbf{|}");
    });

    it("fr⇥ then Tab walks the empty groups, _ adds braces, Tab leaves them", async () => {
      setup();
      await typeAll("$fr");
      tab();
      expect(show()).toBe("$\\frac{|}{}$");
      await typeAll("a");
      tab();
      expect(show()).toBe("$\\frac{a}{|}$");
      await typeAll("x_2");
      expect(show()).toBe("$\\frac{a}{x_{2|}}$");
      tab(); // leave the subscript, simplifying it (cdlatex)
      expect(show()).toBe("$\\frac{a}{x_2|}$");
    });

    it("lr( eats the auto-paired closer", async () => {
      setup();
      await typeAll("$lr[");
      expect(show()).toBe("$lr[|]$");
      tab();
      expect(show()).toBe("$\\left[ | \\right]$");
    });

    it("' modifies the last letter, ` inserts symbols", async () => {
      setup();
      await typeAll("$ab'.+`a");
      expect(show()).toBe("$a\\dot{b}+\\alpha|$");
    });
  });

  describe("Tab and Shift+Tab stay in math", () => {
    let ta: HTMLTextAreaElement;
    const show = () => ta.value.slice(0, ta.selectionStart) + "|" + ta.value.slice(ta.selectionEnd);
    const tab = (shift = false) =>
      !ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true }));
    const at = (value: string) => {
      detach?.();
      document.body.innerHTML = "<textarea></textarea>";
      ta = document.querySelector("textarea")!;
      const pos = value.indexOf("|");
      ta.value = value.replace("|", "");
      ta.focus();
      ta.setSelectionRange(pos, pos);
      detach = new LaasController({ host: "example.com" }).attach();
    };

    it("Shift+Tab goes back to the previous stop instead of the previous button", () => {
      at("a $\\frac{x}{y}|$ b");
      expect(tab(true)).toBe(true);
      expect(show()).toBe("a $\\frac{x}{y|}$ b");
      tab(true);
      expect(show()).toBe("a $\\frac{x|}{y}$ b");
      tab(true);
      expect(show()).toBe("a $|\\frac{x}{y}$ b");
    });

    it("at the start of a formula, Shift+Tab steps out before the $", () => {
      at("a $|x$ b");
      expect(tab(true)).toBe(true);
      expect(show()).toBe("a |$x$ b");
      expect(tab(true)).toBe(false); // now in text: left to the page
    });

    it("right after a formula, Shift+Tab steps back in; Tab before one steps in", () => {
      at("a $x$| b");
      tab(true);
      expect(show()).toBe("a $x|$ b");
      at("a |$x$ b");
      expect(tab()).toBe(true);
      expect(show()).toBe("a $|x$ b");
    });

    it("an expansion replaces the closer the editor auto-inserted", async () => {
      at("$a |$");
      // like CodeMirror's closeBrackets: typing ' inserts '' with the caret between
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "'", bubbles: true }));
      const p = ta.selectionStart;
      ta.setRangeText("''", p, p, "start");
      ta.setSelectionRange(p + 1, p + 1);
      await tick();
      type(ta, "[");
      await tick();
      expect(show()).toBe("$a \\left[ | \\right]$");
    });
  });

  describe("input methods", () => {
    let ta: HTMLTextAreaElement;
    const setup = (value: string) => {
      detach?.();
      document.body.innerHTML = "<textarea></textarea>";
      ta = document.querySelector("textarea")!;
      ta.value = value;
      ta.focus();
      ta.setSelectionRange(value.length, value.length);
      detach = new LaasController({ host: "example.com" }).attach();
    };
    /** an IME commits `text`: keydown 229, composition, then the text appears */
    const imeCommit = (text: string) => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", keyCode: 229, bubbles: true }));
      ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const p = ta.selectionStart;
      ta.setRangeText(text, p, p, "end");
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: text, bubbles: true }));
    };
    /** text inserted with no keydown at all (some IMEs, accessibility tools) */
    const insertOnly = (text: string) => {
      const p = ta.selectionStart;
      ta.setRangeText(text, p, p, "end");
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
    };

    it("triggers ending in a character committed by an IME", async () => {
      setup("$x ");
      type(ta, "`");
      await tick();
      imeCommit("a");
      await tick();
      expect(ta.value).toBe("$x \\alpha");
      setup("$x ");
      imeCommit("'");
      await tick();
      type(ta, "[");
      await tick();
      expect(ta.value).toBe("$x \\left[  \\right]");
    });

    it("triggers ending in text inserted without a keydown", async () => {
      setup("$x ");
      insertOnly(";");
      await tick();
      insertOnly("b");
      await tick();
      expect(ta.value).toBe("$x \\beta ");
    });

    it("ignores Chinese text from the IME", async () => {
      setup("$x ");
      imeCommit("你好");
      await tick();
      expect(ta.value).toBe("$x 你好");
    });
  });

  describe("live preview hook (onFormula)", () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    it("reports the formula under the caret, and null outside math", async () => {
      document.body.innerHTML = "<textarea></textarea>";
      const ta = document.querySelector("textarea")!;
      ta.value = "see $\\frac{a}{b}$ here";
      ta.focus();
      ta.setSelectionRange(14, 14); // after "b"
      const seen: unknown[] = [];
      detach = new LaasController({ host: "example.com", onFormula: (f) => seen.push(f && { latex: f.latex, caret: f.caret, hasRect: !!f.rect }) }).attach();
      ta.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      await frame();
      expect(seen.at(-1)).toEqual({ latex: "\\frac{a}{b}", caret: 9, hasRect: true });
      ta.setSelectionRange(1, 1);
      ta.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
      await frame();
      expect(seen.at(-1)).toBeNull();
      // unchanged state: no repeat report
      const n = seen.length;
      ta.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
      await frame();
      expect(seen.length).toBe(n);
    });

    it("gives each formula its own id, stable while the caret moves inside it", async () => {
      document.body.innerHTML = "<textarea></textarea>";
      const ta = document.querySelector("textarea")!;
      ta.value = "$x$ and $x$";
      ta.focus();
      const ids: string[] = [];
      detach = new LaasController({ host: "example.com", onFormula: (f) => f && ids.push(f.id) }).attach();
      for (const pos of [1, 2, 9]) {
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
        await frame();
      }
      expect(ids).toHaveLength(3);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });

    it("drops formula work still queued when it detaches", async () => {
      document.body.innerHTML = "<textarea></textarea>";
      const ta = document.querySelector("textarea")!;
      ta.value = "$x$";
      ta.focus();
      ta.setSelectionRange(2, 2);
      const seen: unknown[] = [];
      const c = new LaasController({ host: "example.com", onFormula: (f) => seen.push(f) });
      c.attach();
      c.refreshFormula(); // queued for the next frame…
      c.detach(); // …but the controller is gone by then
      await frame();
      ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await frame();
      expect(seen.filter((f) => f !== null)).toEqual([]);
    });

    it("updates after an expansion", async () => {
      document.body.innerHTML = "<textarea></textarea>";
      const ta = document.querySelector("textarea")!;
      ta.value = "$";
      ta.focus();
      ta.setSelectionRange(1, 1);
      let last: { latex: string; caret: number } | null = null;
      detach = new LaasController({ host: "example.com", onFormula: (f) => (last = f && { latex: f.latex, caret: f.caret }) }).attach();
      for (const ch of "x/") {
        type(ta, ch);
        await tick();
      }
      await frame();
      expect(last).toEqual({ latex: "\\frac{x}{}", caret: 9 });
    });
  });

  it("respects filter, setState and detach", async () => {
    document.body.innerHTML = "<textarea id=a></textarea>";
    const ta = document.querySelector("textarea")!;
    ta.focus();
    const c = new LaasController({ host: "example.com", filter: (el) => el.id === "a" });
    detach = c.attach();
    c.setState({ configText: `{ useDefaults: false, snippets: [{ trigger: "zz", replacement: "Z", options: "A" }] }` });
    for (const ch of "mkzz") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("mkZ");
    c.setState({ enabled: false });
    for (const ch of "zz") {
      type(ta, ch);
      await tick();
    }
    expect(ta.value).toBe("mkZzz");
  });

  it("uses custom adapters before the built-ins", async () => {
    document.body.innerHTML = `<div id="fake" tabindex="0"></div>`;
    const el = document.getElementById("fake")!;
    el.focus();
    let text = "";
    let caret = 0;
    const adapter: EditorAdapter = {
      kind: "fake",
      id: el,
      getSelection: () => ({ from: caret, to: caret }),
      getLength: () => text.length,
      textBefore: (pos, max) => text.slice(Math.max(0, pos - max), pos),
      slice: (a, b) => text.slice(a, b),
      replace: (a, b, t, s) => {
        text = text.slice(0, a) + t + text.slice(b);
        caret = s;
      },
      setSelection: (a) => (caret = a),
    };
    detach = new LaasController({ adapters: [(e) => (e === el ? adapter : null)] }).attach();
    for (const ch of "$;a") {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      text = text.slice(0, caret) + ch + text.slice(caret);
      caret++;
      await tick();
    }
    expect(text).toBe("$\\alpha $"); // cdlatex paired the $, laas auto space
  });
});
