// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("replies false while disabled and true after the same frame is re-enabled", async () => {
  let listener: any;
  let disabled = true;
  const executeScript = vi.fn().mockResolvedValue([]);
  const event = { addListener: vi.fn() };
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (f: any) => { listener = f; } }, onStartup: event, onInstalled: event },
    storage: { local: { get: async () => ({ disabledHosts: disabled ? ["chatgpt.com"] : [] }) }, onChanged: event },
    scripting: { executeScript }, commands: { onCommand: event },
  });
  await import("../../src/background");
  const reply = vi.fn();
  const sender = { tab: { id: 7 }, frameId: 2, url: "https://chatgpt.com/" };
  expect(listener({ type: "load-composer" }, sender, reply)).toBe(true);
  await flush();
  expect(reply).toHaveBeenLastCalledWith(false);
  expect(executeScript).not.toHaveBeenCalled();
  disabled = false;
  listener({ type: "load-composer" }, sender, reply);
  await flush();
  expect(reply).toHaveBeenLastCalledWith(true);
  expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, frameIds: [2] }, files: ["composer.js"], injectImmediately: true });
});

it("retries a declined composer request when settings change without a reload", async () => {
  vi.useFakeTimers();
  let changed: any;
  const sendMessage = vi.fn(async (msg) => msg.type === "load-composer" ? false : {});
  vi.stubGlobal("chrome", {
    runtime: { id: "test", sendMessage, onMessage: { addListener: vi.fn() } },
    storage: { local: { get: async () => ({ prefs: { composer: true, composerSites: [location.hostname], inlineRender: false } }) },
      onChanged: { addListener: (f: any) => { changed = f; } } },
  });
  await import("../../src/content/isolated");
  await flush();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === "load-composer")).toHaveLength(1);
  changed({ disabledHosts: { newValue: [] } }, "local");
  await flush();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === "load-composer")).toHaveLength(2);
});
