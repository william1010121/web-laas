// In-memory stand-ins for the chrome.* APIs used by the extension pages.
(() => {
  const store = {};
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (o) => {
          const changes = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }]));
          Object.assign(store, o);
          listeners.forEach((l) => l(changes, "local"));
        },
      },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
    commands: {
      getAll: async () => [
        { name: "toggle-enabled", description: "Turn LaTeX auto-snippets on or off", shortcut: "⌥⇧L" },
        { name: "toggle-cheatsheet", description: "Open or close the snippet cheat sheet", shortcut: "⌥⇧K" },
      ],
    },
    runtime: { getManifest: () => ({ version: "0.2.0" }), sendMessage: async () => {}, openOptionsPage() {} },
    tabs: { query: async () => [{ id: 1, url: "https://www.overleaf.com/project/1" }], create() {} },
  };
})();
