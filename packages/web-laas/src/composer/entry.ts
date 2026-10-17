// composer.js (experimental): injected into the top frame of the sites listed
// in the settings. It hides the site's own message box and puts a CodeMirror
// editor in its place, with formulas typeset in place and the snippets on.
// The site's box stays in the page, kept in step with what's typed, so the
// site's own send button, drafts and attachments work as before.
import { hostMatches } from "web-laas-engine";
import { LaasController } from "web-laas-engine/dom";
import type { EditorView } from "@codemirror/view";
import { alive } from "../shared/alive";
import { MATH_CSS } from "../shared/math";
import { loadState, stateForSite, STORAGE_KEYS, type StoredState } from "../shared/storage";
import { createEditor, handleTakenKey, setText, vimCommandMode } from "./editor";
import { inputKind, inputText, siteInput, type SiteInput } from "./sites";

declare global {
  interface Window {
    __webLaasComposerAlive?: () => boolean;
    /** called by content-isolated.js's early key listener, before the site's own (see handleTakenKey) */
    __webLaasComposerKey?: (e: KeyboardEvent) => boolean;
  }
}

/** Sent on the site's Quill box: the main-world script sets its text (Quill lives there). */
const QUILL_SET_EVENT = "web-laas:composer-set";

const CSS = `
${MATH_CSS}
[data-web-laas-hidden] {
  position: absolute !important; opacity: 0 !important; pointer-events: none !important;
  width: 1px !important; height: 1px !important; min-height: 0 !important; max-height: 1px !important;
  overflow: hidden !important;
  /* what we write into it doesn't make the browser lay out the rest of the page again */
  contain: strict !important;
}
/* typing that doesn't change its size is laid out here only, not across a long conversation */
[data-web-laas-composer] { position: relative; width: 100%; text-align: start; contain: layout style; }
[data-web-laas-composer] .wl-back, [data-web-laas-composer-off] .wl-back {
  position: absolute; top: 0; right: 0; z-index: 1;
  border: 0; border-radius: 6px; padding: 1px 6px; cursor: pointer;
  font: 600 10px/1.6 ui-sans-serif, -apple-system, sans-serif; letter-spacing: .02em;
  color: inherit; background: rgba(127,127,127,.12); opacity: .45;
}
[data-web-laas-composer] .wl-back:hover { opacity: 1; }
/* switched off: the same button over the site's own box, to switch back on */
[data-web-laas-composer-off] { position: relative; height: 0; width: 100%; }
[data-web-laas-composer-off] .wl-back { opacity: .3; text-decoration: line-through; }
[data-web-laas-composer-off] .wl-back:hover { opacity: 1; text-decoration: none; }
`;

class Composer {
  private host: HTMLElement;
  private view: EditorView;
  /** the site's text as last read (or written): a change from anything else came from the site */
  private seen: string;
  private pushTimer = 0;
  private writing = false;
  private observer: MutationObserver;

  constructor(
    readonly input: HTMLElement,
    private site: SiteInput,
    private keys: EditorKeys,
  ) {
    this.seen = inputText(input);
    this.host = document.createElement("div");
    this.host.dataset.webLaasComposer = "";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "wl-back";
    back.textContent = "TeX";
    back.title = "web-laas editor on: click to use the site's own box (click again to switch back)";
    back.addEventListener("click", () => setOff(true));
    this.host.append(back);
    this.view = createEditor({
      parent: this.host,
      doc: this.seen,
      placeholder: placeholderOf(input),
      onSend: () => this.send(),
      onChange: () => this.schedulePush(),
      ...keys,
    });
    const hadFocus = input.contains(document.activeElement);
    input.before(this.host);
    input.dataset.webLaasHidden = "";
    if (hadFocus) this.view.focus();
    // whatever focuses the site's box (its own shortcuts, a new chat) lands here instead
    input.addEventListener("focus", this.redirect);
    this.host.addEventListener("paste", this.forwardFiles, true);
    // a click anywhere (the site's own send button) first gets the text over
    document.addEventListener("pointerdown", this.flush, true);
    this.observer = new MutationObserver(() => this.pull());
    this.observer.observe(input, { childList: true, subtree: true, characterData: true, attributes: false });
    if (input instanceof HTMLTextAreaElement) input.addEventListener("input", this.pull);
  }

  get mounted() {
    return this.host.isConnected && this.input.isConnected && this.host.nextElementSibling === this.input;
  }

  focus() {
    this.view.focus();
  }

  handleKey(e: KeyboardEvent): boolean {
    return handleTakenKey(this.view, e, this.keys);
  }

  /** Vim's normal or visual mode: keys are commands, no snippets */
  get commandMode() {
    return vimCommandMode(this.view);
  }

  destroy() {
    clearTimeout(this.pushTimer);
    this.push(); // the site's box keeps what was typed
    this.observer.disconnect();
    this.input.removeEventListener("focus", this.redirect);
    this.input.removeEventListener("input", this.pull);
    document.removeEventListener("pointerdown", this.flush, true);
    delete this.input.dataset.webLaasHidden;
    this.view.destroy();
    this.host.remove();
  }

  /**
   * Another script focusing the site's box usually writes into it at once
   * (ChatSprig's "Ask in sidebar": focus, caret to the end, insertText): let it
   * finish there, then take the focus. What it wrote comes over through pull.
   */
  private redirect = () => {
    if (this.writing) return;
    setTimeout(() => {
      if (this.host.isConnected && this.input.contains(document.activeElement)) {
        this.pull();
        this.view.focus();
        this.view.dispatch({ selection: { anchor: this.view.state.doc.length } });
      }
    }, 0);
  };

  /** The site changed its box (cleared it after sending, restored a draft…): show that. */
  private pull = () => {
    if (this.writing) return;
    const text = inputText(this.input);
    if (text === this.seen) return;
    this.seen = text;
    // (not while an IME is composing: the next change brings it)
    if (this.view.composing) return;
    clearTimeout(this.pushTimer);
    setText(this.view, text);
    clearTimeout(this.pushTimer); // that was the site's text: nothing to send back
  };

  // (each push has the site's editor take in the whole text: not after every key)
  private schedulePush() {
    clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => this.push(), 400);
  }

  private flush = () => {
    if (this.pushTimer) this.push();
  };

  /** Write our text into the site's box, without moving the focus or the caret. */
  private push() {
    clearTimeout(this.pushTimer);
    this.pushTimer = 0;
    const text = this.view.state.doc.toString();
    if (text === this.seen) return;
    const el = this.input;
    this.writing = true;
    try {
      writeInput(el, text);
    } finally {
      this.writing = false;
    }
    // what the site made of it (it may tidy it up): later reads compare against this
    this.seen = inputText(el);
    // some editors update the page a moment later
    setTimeout(() => (this.seen = inputText(el)), 60);
  }

  private send(): boolean {
    if (!this.view.state.doc.toString().trim()) return true;
    this.push();
    // the site enables its send button once it has seen the text
    setTimeout(() => {
      const button =
        (this.site.send ? document.querySelector<HTMLButtonElement>(this.site.send) : null) ??
        this.input.closest("form")?.querySelector<HTMLButtonElement>('button[type="submit"]');
      // (a disabled button: the site isn't ready, e.g. still answering; the text stays)
      if (button) {
        if (!button.disabled && button.getAttribute("aria-disabled") !== "true") button.click();
      } else pressEnter(this.input);
    }, 80);
    return true;
  }

  /** Pasted images and files go to the site's box, which knows how to attach them. */
  private forwardFiles = (e: ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (!files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    this.input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  };
}

function placeholderOf(el: HTMLElement): string {
  const p =
    el.getAttribute("data-placeholder") ??
    el.querySelector("[data-placeholder]")?.getAttribute("data-placeholder") ??
    el.getAttribute("placeholder") ??
    el.getAttribute("aria-label");
  return p?.trim() || "Message";
}

const mac = /Mac|iPhone|iPad/.test(navigator.platform);

function key(el: HTMLElement, init: KeyboardEventInit) {
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

function pressEnter(el: HTMLElement) {
  key(el, { key: "Enter", code: "Enter", keyCode: 13 });
}

/** Replace the text of the site's box, the way its editor takes it in. */
function writeInput(el: HTMLElement, text: string) {
  switch (inputKind(el)) {
    case "field": {
      const field = el as HTMLTextAreaElement;
      field.value = text; // (the native setter: frameworks hear about it from the input event)
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    case "quill":
      el.dispatchEvent(new CustomEvent(QUILL_SET_EVENT, { bubbles: true, detail: text }));
      return;
    case "prosemirror": {
      // select all with its own keymap (no focus needed: the DOM selection stays where it is),
      // then paste over it, or delete it
      key(el, { key: "a", code: "KeyA", keyCode: 65, metaKey: mac, ctrlKey: !mac });
      if (!text) return key(el, { key: "Backspace", code: "Backspace", keyCode: 8 });
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      return;
    }
    default: {
      // a plain contenteditable: through the selection, then back to our editor
      const active = document.activeElement as HTMLElement | null;
      const sel = document.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (text) document.execCommand("insertText", false, text);
      else document.execCommand("delete", false);
      active?.focus({ preventScroll: true });
    }
  }
}

// ── lifecycle ───────────────────────────────────────────────────────────

let composer: Composer | null = null;
/** "TeX" was clicked: the site's own box, until it's clicked again or the page reloads */
let off = false;
/** the button over the site's box while switched off */
let offButton: HTMLElement | null = null;
let wanted = false;
let site: SiteInput = siteInput(location.hostname);
let controller: LaasController | null = null;

/** The editor's key settings (changing them builds the editor again). */
interface EditorKeys {
  vim: boolean;
  modEnter: boolean;
}
let keys: EditorKeys = { vim: false, modEnter: false };
/** the live preview in Vim's normal mode too */
let vimPreview = false;

function setOff(value: boolean) {
  off = value;
  const hadFocus = !!document.activeElement?.closest("[data-web-laas-composer]");
  check();
  // focus follows the switch, into whichever box is showing now
  if (off) {
    if (hadFocus) findInput()?.focus();
  } else composer?.focus();
}

/** While off: a "TeX" button over the site's box, in the same corner, that switches back. */
function showOffButton(input: HTMLElement | null) {
  if (!input || !wanted || !off) {
    offButton?.remove();
    offButton = null;
    return;
  }
  if (offButton?.isConnected && offButton.nextElementSibling === input) return;
  offButton?.remove();
  offButton = document.createElement("div");
  offButton.dataset.webLaasComposerOff = "";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "wl-back";
  b.textContent = "TeX";
  b.title = "web-laas editor off: click to type with formulas rendered in place";
  b.addEventListener("click", () => setOff(false));
  offButton.append(b);
  input.before(offButton);
}

/** The site's message box: the biggest visible one. */
function findInput(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let area = 0;
  for (const el of document.querySelectorAll<HTMLElement>(site.input)) {
    if (el.closest("[data-web-laas-composer]")) continue;
    const r = el.getBoundingClientRect();
    const a = el.dataset.webLaasHidden !== undefined ? Infinity : r.width * r.height;
    if (a > area) [best, area] = [el, a];
  }
  return area > 0 ? best : null;
}

function check() {
  if (!alive()) return stop();
  if (!wanted || off) {
    composer?.destroy();
    composer = null;
    showOffButton(wanted && off ? findInput() : null);
    return;
  }
  showOffButton(null);
  const input = findInput();
  if (composer && (!composer.mounted || composer.input !== input)) {
    // the site rebuilt its box (a new chat, another page of the app)
    const hadFocus = composer && document.activeElement?.closest("[data-web-laas-composer]");
    composer.destroy();
    composer = null;
    if (input && hadFocus) queueMicrotask(() => composer?.focus());
  }
  if (!composer && input) composer = new Composer(input, site, keys);
}

let timer = 0;
let mo: MutationObserver | null = null;

function stop() {
  clearInterval(timer);
  mo?.disconnect();
  controller?.detach();
  offButton?.remove();
  composer?.destroy();
  composer = null;
}

async function apply() {
  if (!alive()) return stop();
  const state: StoredState = await loadState();
  const host = location.hostname;
  wanted =
    state.enabled &&
    state.prefs.composer &&
    state.prefs.composerSites.some((p) => hostMatches(host, p)) &&
    !state.disabledHosts.some((p) => hostMatches(host, p));
  // the snippets in our editor: the page's own engine can't reach it (it's in this world)
  vimPreview = !!state.prefs.composerVimPreview;
  controller?.setState(stateForSite(state, host));
  // the preview off: no looking for the formula under the caret
  controller?.watchFormula(state.prefs.preview !== "off");
  // (the config's own disabledSites too, as when the page loads)
  if (controller && !controller.active) wanted = false;
  const next = { vim: !!state.prefs.composerVim, modEnter: !!state.prefs.composerModEnter };
  if (next.vim !== keys.vim || next.modEnter !== keys.modEnter) {
    keys = next;
    // the text stays in the site's box, and comes back in the new editor
    const hadFocus = !!document.activeElement?.closest("[data-web-laas-composer]");
    composer?.destroy();
    composer = null;
    check(); // (sets composer)
    if (hadFocus) (composer as Composer | null)?.focus();
  }
  check();
}

if (!window.__webLaasComposerAlive?.()) {
  window.__webLaasComposerAlive = alive;
  window.__webLaasComposerKey = (e) =>
    !!composer && e.target instanceof Node && !!(e.target as Element).closest?.("[data-web-laas-composer]") && composer.handleKey(e);
  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
  controller = new LaasController({
    // (the live preview in Vim's normal mode only when asked for)
    filter: (el) => !!el.closest("[data-web-laas-composer]") && (vimPreview || !composer?.commandMode),
    // keys in Vim's normal mode are commands: "k" moves, it doesn't end a trigger like mk
    typing: () => !composer?.commandMode,
    // the live preview card (preview.js) listens for these
    onFormula: (f) => document.dispatchEvent(new CustomEvent("web-laas:formula", { detail: JSON.stringify(f) })),
  });
  controller.attach();
  void apply();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => (STORAGE_KEYS as readonly string[]).includes(k))) void apply();
  });
  // the box comes and goes as the app moves between pages. Finding it searches the whole page
  // (milliseconds on a long chat), so only elements coming or going outside our editor and the
  // box it stands in for count (typing changes only those), and it's looked for at most every 200 ms
  let queued = false;
  let lastCheck = -Infinity;
  const outside = (n: Node) => {
    const el = n instanceof Element ? n : n.parentElement;
    return !el?.closest("[data-web-laas-composer], [data-web-laas-hidden], [data-web-laas-composer-off]");
  };
  mo = new MutationObserver((records) => {
    if (queued) return;
    // (anything taken out counts, our editor too: the site may have rebuilt that part of the page)
    const relevant = records.some(
      (r) =>
        outside(r.target) &&
        ([...r.addedNodes].some((n) => n instanceof Element && outside(n)) || [...r.removedNodes].some((n) => n instanceof Element)),
    );
    if (!relevant) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      lastCheck = performance.now();
      check();
    }, Math.max(0, lastCheck + 200 - performance.now()));
  });
  mo.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  // (while our editor is in place the observer above notices the page changing: this is for a
  // box that showed up without it, and for noticing the extension went away)
  timer = window.setInterval(() => (!alive() ? stop() : composer?.mounted ? undefined : check()), 2000);
}
