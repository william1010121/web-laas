// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LivePreview } from "../../src/preview/preview";

describe("LivePreview layout", () => {
  it("counts padding and border inside the viewport width (border-box)", () => {
    const p = new LivePreview(document);
    p.update({ latex: "x", caret: 1, display: false, rect: { left: 0, top: 50, bottom: 70 } });
    const host = document.querySelector("[data-web-laas-preview]")!;
    expect(host).not.toBeNull();
    const root = (p as unknown as { card: HTMLElement }).card.getRootNode() as ShadowRoot;
    const css = [...root.querySelectorAll("style")].map((st) => st.textContent).join("");
    expect(css).toMatch(/\.card\s*\{[^}]*box-sizing:\s*border-box/);
  });
});

describe("LivePreview fallback", () => {
  it("keeps the last good render only for the formula being edited", () => {
    window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const p = new LivePreview(document);
    const rect = { left: 10, top: 100, bottom: 120 };
    const internals = p as unknown as { math: HTMLElement; card: HTMLElement };
    const html = () => internals.math.innerHTML;
    const stale = () => internals.card.classList.contains("stale");

    p.update({ latex: "a + b", caret: 5, display: false, rect });
    expect(html()).toContain("<math");
    p.update({ latex: "a + \\frac{b}{", caret: 13, display: false, rect }); // half-typed: keep it, dimmed
    expect(html()).toContain("<math");
    expect(stale()).toBe(true);
    p.update(null); // the caret left the formula
    p.update({ latex: "\\frac{c}{", caret: 9, display: false, rect }); // another formula, half-typed
    expect(html()).toBe("");
    expect(p.visible).toBe(false);
  });
});
