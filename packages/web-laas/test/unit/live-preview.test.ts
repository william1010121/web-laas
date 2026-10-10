// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LivePreview } from "../../src/preview/preview";

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
