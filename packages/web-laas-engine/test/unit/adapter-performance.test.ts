// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { TextFieldAdapter } from "../../src/dom/adapters/textarea";
import { ContentEditableAdapter } from "../../src/dom/adapters/contenteditable";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("reuses one marked, contained caret mirror across fields and releases its text", () => {
  const a = document.createElement("textarea"), b = document.createElement("input");
  document.body.append(a, b);
  a.value = "long draft"; b.value = "second";
  new TextFieldAdapter(a).caretRect();
  const mirror = document.querySelector<HTMLElement>("[data-web-laas-mirror]");
  expect(mirror).not.toBeNull();
  expect(mirror!.style.contain).toContain("layout");
  for (let i = 0; i < 5; i++) new TextFieldAdapter(b).caretRect();
  expect(document.querySelectorAll("[data-web-laas-mirror]")).toHaveLength(1);
  expect(document.querySelector("[data-web-laas-mirror]")).toBe(mirror);
  expect(mirror!.textContent).toBe("");
});

it("linearizes a contenteditable once for selection and text reads", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>abc</p><p>def</p>";
  document.body.append(root);
  const first = root.firstChild!.firstChild!, last = root.lastChild!.firstChild!;
  const read = vi.spyOn(first as Text, "data", "get");
  document.getSelection()!.setBaseAndExtent(first, 1, last, 2);
  const adapter = new ContentEditableAdapter(root);
  expect(adapter.getSelection()).toEqual({ from: 1, to: 6 });
  expect(adapter.textBefore(6, 100)).toBe("abc\nde");
  expect(adapter.getLength()).toBe(7);
  adapter.setSelection(2, 5);
  expect(adapter.getSelection()).toEqual({ from: 2, to: 5 });
  expect(read).toHaveBeenCalledTimes(1);
});

it("invalidates cached positions for synchronous framework mutations", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>abc</p><p>def</p>";
  document.body.append(root);
  const adapter = new ContentEditableAdapter(root);
  expect(adapter.getLength()).toBe(7);
  (root.firstChild!.firstChild! as Text).data = "abcdef";
  adapter.setSelection(8, 9);
  expect(adapter.getSelection()).toEqual({ from: 8, to: 9 });
  expect(adapter.textBefore(9, 20)).toBe("abcdef\nde");
});

it("preserves block boundaries, breaks and non-editable island offsets", () => {
  const root = document.createElement("div");
  root.innerHTML = '<p>abc<br>x</p><p><span contenteditable="false"><b>widget</b></span>z</p>';
  document.body.append(root);
  const adapter = new ContentEditableAdapter(root);
  const select = (node: Node, offset: number) => { document.getSelection()!.collapse(node, offset); return adapter.getSelection(); };
  expect(adapter.slice(0, 100)).toBe("abc\nx\n\ufffcz");
  expect(select(root, 1)).toEqual({ from: 5, to: 5 });
  expect(select(root.lastChild!, 0)).toEqual({ from: 6, to: 6 });
  expect(select(root.querySelector("b")!.firstChild!, 3)).toEqual({ from: 6, to: 6 });
});
