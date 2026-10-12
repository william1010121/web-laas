// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageRender, messageSelector } from "../../src/preview/messages";

const page = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

const settle = async () => {
  await Promise.resolve(); // the observer's callback
  vi.advanceTimersByTime(200);
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("messageSelector", () => {
  it("knows the chat sites and only them", () => {
    expect(messageSelector("claude.ai")).toBeTruthy();
    expect(messageSelector("chatgpt.com")).toBeTruthy();
    expect(messageSelector("gemini.google.com")).toBeTruthy();
    expect(messageSelector("www.overleaf.com")).toBeNull();
    expect(messageSelector("notclaude.ai")).toBeNull();
  });
});

describe("MessageRender", () => {
  it("typesets a sent message after it and hides the original (Claude)", async () => {
    vi.useFakeTimers();
    page('<div data-testid="user-message"><p class="whitespace-pre-wrap">what is $p(\\cdot|x)$ here</p></div>');
    const r = new MessageRender(document, messageSelector("claude.ai")!);
    r.set(true);
    await settle();
    const source = document.querySelector('[data-testid="user-message"]')!;
    expect(source.hasAttribute("data-web-laas-msg")).toBe(true);
    const copy = source.nextElementSibling as HTMLElement;
    expect(copy.hasAttribute("data-web-laas-msg-copy")).toBe(true);
    expect(copy.querySelector("[data-latex]")?.getAttribute("data-latex")).toBe("$p(\\cdot|x)$");
    expect(copy.querySelector("mjx-container svg")).toBeTruthy();
    // copying (natively) and screen readers get the source, not the SVG
    expect(copy.querySelector(".web-laas-src")?.textContent).toBe("$p(\\cdot|x)$");
    expect(copy.querySelector("mjx-container")?.getAttribute("aria-hidden")).toBe("true");
    expect(copy.textContent).toContain("what is ");
    expect(copy.textContent).toContain(" here");
    // the page's own text is untouched
    expect(source.textContent).toBe("what is $p(\\cdot|x)$ here");
    r.destroy();
    expect(source.hasAttribute("data-web-laas-msg")).toBe(false);
    expect(document.querySelector("[data-web-laas-msg-copy]")).toBeNull();
  });

  it("reads display math across Gemini's line paragraphs", async () => {
    vi.useFakeTimers();
    page(
      '<user-query><div class="query-text"><h5 class="cdk-visually-hidden">You said $$\\mu_c = x,…</h5><p class="query-text-line">$$\\mu_c = x,</p><p class="query-text-line">\\qquad y$$</p><p class="query-text-line">and $a$</p></div></user-query>',
    );
    const r = new MessageRender(document, messageSelector("gemini.google.com")!);
    r.set(true);
    await settle();
    const maths = [...document.querySelectorAll<HTMLElement>("[data-web-laas-msg-copy] [data-latex]")].map((m) => m.dataset.latex);
    expect(maths).toEqual(["$$\\mu_c = x,\n\\qquad y$$", "$a$"]);
    r.destroy();
  });

  it("leaves messages without math and prices alone (ChatGPT)", async () => {
    vi.useFakeTimers();
    page('<div data-message-author-role="user"><div class="whitespace-pre-wrap">it costs $5 and $10</div></div>');
    const r = new MessageRender(document, messageSelector("chatgpt.com")!);
    r.set(true);
    await settle();
    expect(document.querySelector("[data-web-laas-msg-copy]")).toBeNull();
    expect(document.querySelector("[data-web-laas-msg]")).toBeNull();
    r.destroy();
  });

  it("follows the page: a new message, an edited one, a removed one", async () => {
    vi.useFakeTimers();
    page('<main><div data-testid="user-message"><p>$x$</p></div></main>');
    const r = new MessageRender(document, messageSelector("claude.ai")!);
    r.set(true);
    await settle();
    expect(document.querySelectorAll("[data-web-laas-msg-copy]").length).toBe(1);

    const main = document.querySelector("main")!;
    main.insertAdjacentHTML("beforeend", '<div data-testid="user-message"><p>$y$</p></div>');
    await settle();
    expect(document.querySelectorAll("[data-web-laas-msg-copy]").length).toBe(2);

    const first = document.querySelector('[data-testid="user-message"] p')!;
    first.textContent = "$z$";
    await settle();
    const latex = [...document.querySelectorAll<HTMLElement>("[data-latex]")].map((m) => m.dataset.latex);
    expect(latex).toEqual(["$z$", "$y$"]);

    document.querySelectorAll('[data-testid="user-message"]:not([data-web-laas-msg-copy])')[1].remove();
    await settle();
    expect(document.querySelectorAll("[data-web-laas-msg-copy]").length).toBe(1);
    r.destroy();
  });
});
