// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EditorScopes } from "../../src/content/editor-scopes";
import { renderWantedOnSite } from "../../src/content/render-wanted";
import { DEFAULT_EXTENSION_PREFS, type StoredState } from "../../src/shared/storage";
import { CM5Math } from "../../src/content/cm5-math";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("discovers shadows once, then only added subtrees and late focused roots", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<textarea>$x$</textarea>";
  const query = vi.spyOn(document, "querySelectorAll");
  const scopes = new EditorScopes(document, () => {});
  expect(scopes.all()).toEqual([document, shadow]);
  for (let i = 0; i < 10; i++) scopes.all();
  expect(query).toHaveBeenCalledTimes(1);
  const added = document.createElement("div");
  const nested = added.attachShadow({ mode: "open" });
  shadow.append(added);
  expect(scopes.all()).toContain(nested);
  host.remove();
  expect(scopes.all()).toEqual([document]);
  const late = document.createElement("div");
  document.body.append(late);
  scopes.all();
  const lateRoot = late.attachShadow({ mode: "open" });
  scopes.see({ composedPath: () => [lateRoot, late, document] } as unknown as Event);
  expect(scopes.all()).toContain(lateRoot);
  scopes.destroy();
});

it("does not poll all of an ordinary page for CodeMirror", async () => {
  vi.useFakeTimers();
  const query = vi.spyOn(document, "querySelectorAll");
  const render = new CM5Math();
  render.set(true, false);
  query.mockClear();
  vi.advanceTimersByTime(15000);
  expect(query).not.toHaveBeenCalled();
  const wrapper = document.createElement("div");
  wrapper.className = "CodeMirror";
  document.body.append(wrapper);
  await Promise.resolve();
  // The wrapper may precede the CodeMirror property. Discover it on a later tick.
  const cm = { getOption: () => "markdown", on: vi.fn(), off: vi.fn(), getValue: () => "", getViewport: () => ({ from: 0, to: 1 }), indexFromPos: () => 0, listSelections: () => [] };
  (wrapper as any).CodeMirror = cm;
  vi.advanceTimersByTime(1500);
  expect(cm.on).toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  render.set(false, false);
  expect(cm.off).toHaveBeenCalled();
  expect(wrapper.hasAttribute("data-web-laas-native")).toBe(false);
});


it("eventually discovers a shadow attached to an existing unfocused host", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const found = vi.fn();
  const scopes = new EditorScopes(document, found);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<textarea>$late$</textarea>";
  expect(scopes.all()).not.toContain(root);
  vi.advanceTimersByTime(10000);
  expect(scopes.all()).toContain(root);
  expect(found).toHaveBeenCalledWith(root);
  scopes.destroy();
  expect(vi.getTimerCount()).toBe(0);
});


it("tears down observers, refresh timers and shadow listeners when its script dies", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const cleanup = vi.fn();
  let active = true;
  const scopes = new EditorScopes(document, () => cleanup, () => active);
  active = false;
  vi.advanceTimersByTime(10000);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(scopes.all()).toEqual([]);
  scopes.see({ composedPath: () => [root, host, document] } as unknown as Event);
  expect(scopes.all()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});


it("does not discover editors on globally disabled, host-disabled or config-disabled sites", () => {
  const state: StoredState = { enabled: true, prefs: DEFAULT_EXTENSION_PREFS, disabledHosts: [], configText: null, siteMath: {}, snippets: [] };
  expect(renderWantedOnSite(state, "chatgpt.com")).toBe(true);
  expect(renderWantedOnSite({ ...state, enabled: false }, "chatgpt.com")).toBe(false);
  expect(renderWantedOnSite({ ...state, prefs: { ...state.prefs, inlineRender: false } }, "chatgpt.com")).toBe(false);
  expect(renderWantedOnSite({ ...state, disabledHosts: ["chatgpt.com"] }, "chatgpt.com")).toBe(false);
  expect(renderWantedOnSite({ ...state, configText: '{ disabledSites: ["chatgpt.com"] }' }, "chatgpt.com")).toBe(false);
  expect(renderWantedOnSite({ ...state, disabledHosts: ["claude.ai"] }, "chatgpt.com")).toBe(true);
});
