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

describe("LivePreview placement", () => {
  it("keeps the top of a card taller than the window on screen", () => {
    const p = new LivePreview(document);
    const card = (p as unknown as { card: HTMLElement }).card;
    Object.defineProperty(card, "offsetHeight", { configurable: true, get: () => 900 });
    Object.defineProperty(card, "offsetWidth", { configurable: true, get: () => 300 });
    for (const mode of ["above", "below", "corner"] as const) {
      p.setMode(mode);
      p.update({ latex: "x", caret: 1, display: true, rect: { left: 100, top: 400, bottom: 420 }, id: mode });
      const root = (p as unknown as { root: HTMLElement }).root;
      const top = Number(/translate\([-\d.]+px, ([-\d.]+)px\)/.exec(root.style.transform)?.[1]);
      expect(top, mode).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("LivePreview dismissal", () => {
  it("Esc lasts until the caret leaves the formula", () => {
    const p = new LivePreview(document);
    const f = { latex: "x", caret: 1, display: false, rect: { left: 10, top: 50, bottom: 70 } };
    const on = () => document.querySelector("[data-web-laas-preview]") !== null && (p as unknown as { visible: boolean }).visible;
    p.update(f);
    expect(on()).toBe(true);
    p.dismiss();
    p.update(f);
    expect(on()).toBe(false);
    p.update(null); // caret left the formula
    p.update(f); // another $x$
    expect(on()).toBe(true);
  });
});

describe("LivePreview formula identity", () => {
  const visible = (p: LivePreview) => (p as unknown as { visible: boolean }).visible;
  it("a different formula with the same text is not dismissed", () => {
    const p = new LivePreview(document);
    const rect = { left: 10, top: 50, bottom: 70 };
    p.update({ latex: "x", caret: 1, display: false, rect, id: "1:5" });
    p.dismiss();
    p.update({ latex: "x", caret: 1, display: false, rect, id: "1:5" });
    expect(visible(p)).toBe(false);
    p.update({ latex: "x", caret: 1, display: false, rect, id: "1:40" }); // clicked straight into another $x$
    expect(visible(p)).toBe(true);
  });

  it("a half-typed formula never shows the previous formula's render", () => {
    const p = new LivePreview(document);
    const rect = { left: 10, top: 50, bottom: 70 };
    p.update({ latex: "a+b", caret: 3, display: false, rect, id: "1:5" });
    expect(visible(p)).toBe(true);
    p.update({ latex: "\\frac{", caret: 6, display: false, rect, id: "1:40" });
    expect(visible(p)).toBe(false);
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
