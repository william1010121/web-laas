import { describe, expect, it } from "vitest";
import { DEFAULT_EXTENSION_PREFS, stateForSite, type StoredState } from "../../src/shared/storage";

describe("stateForSite", () => {
  it("keeps only the entries for this site", () => {
    const state: StoredState = {
      configText: "x",
      enabled: true,
      disabledHosts: ["mail.google.com", "*.example.org", "notion.so"],
      siteMath: { "overleaf.com": {}, "chatgpt.com": {} },
      prefs: DEFAULT_EXTENSION_PREFS,
      snippets: [
        { trigger: "aa", replacement: "A" },
        { trigger: "bb", replacement: "B", sites: ["notion.so"] },
      ],
    };
    const s = stateForSite(state, "www.overleaf.com");
    expect(s.disabledHosts).toEqual([]);
    expect(Object.keys(s.siteMath)).toEqual(["overleaf.com"]);
    expect(stateForSite(state, "docs.example.org").disabledHosts).toEqual(["*.example.org"]);
    expect(s.configText).toBe("x");
    expect(s.snippets.map((x) => x.trigger)).toEqual(["aa"]); // a snippet for another site stays home
    // the composer's site list doesn't name other sites to this one
    expect(s.prefs.composerSites).toEqual([]);
    expect(stateForSite(state, "chatgpt.com").prefs.composerSites).toEqual(["chatgpt.com"]);
  });
});
