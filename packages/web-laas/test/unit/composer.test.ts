// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inputKind, inputText, siteInput } from "../../src/composer/sites";

const box = (html: string, cls = "ProseMirror") => {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  return el;
};

describe("inputText", () => {
  it("reads one line per paragraph, <br> as a line break", () => {
    expect(inputText(box("<p>a $x$</p><p>b</p>"))).toBe("a $x$\nb");
    expect(inputText(box("<p>a<br>b</p>"))).toBe("a\nb");
  });

  it("an empty box is empty text", () => {
    expect(inputText(box("<p><br></p>", "ql-editor"))).toBe("");
    expect(inputText(box('<p class="is-empty"><br class="ProseMirror-trailingBreak"></p>'))).toBe("");
  });

  it("keeps empty lines and a trailing line break", () => {
    expect(inputText(box("<p>a</p><p><br></p><p>b</p>"))).toBe("a\n\nb");
    expect(inputText(box('<p>a<br><br class="ProseMirror-trailingBreak"></p>'))).toBe("a\n");
  });

  it("turns non-breaking spaces into spaces", () => {
    expect(inputText(box("<p>a  b</p>"))).toBe("a  b");
  });

  it("reads a textarea's value", () => {
    const t = document.createElement("textarea");
    t.value = "x\ny";
    expect(inputText(t)).toBe("x\ny");
    expect(inputKind(t)).toBe("field");
  });
});

describe("siteInput", () => {
  it("knows the chat sites, and falls back to any text box", () => {
    expect(siteInput("chatgpt.com").send).toContain("Send");
    expect(siteInput("gemini.google.com").input).toContain("ql-editor");
    expect(siteInput("example.com").send).toBeUndefined();
  });
});
