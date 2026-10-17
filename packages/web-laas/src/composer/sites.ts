// The message boxes the experimental composer takes the place of.

/** How text gets into the site's own box. */
export type InputKind = "prosemirror" | "quill" | "field" | "contenteditable";

export interface SiteInput {
  /** the site's message box */
  input: string;
  /** its send button (in another UI language it may not match: then a submit button, then Enter) */
  send?: string;
}

const SITES: [RegExp, SiteInput][] = [
  [
    /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/,
    { input: '#prompt-textarea[contenteditable="true"], .ProseMirror[contenteditable="true"]', send: '#composer-submit-button, button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]' },
  ],
  [/(^|\.)claude\.ai$/, { input: '.ProseMirror[contenteditable="true"]', send: 'button[aria-label="Send message"], button[aria-label="Send Message"]' }],
  [/(^|\.)gemini\.google\.com$/, { input: '.ql-editor[contenteditable="true"]', send: 'button.send-button, button[aria-label="Send message"]' }],
];

/** Any other site the user added: its biggest text box, sent with Enter. */
const GENERIC: SiteInput = { input: 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]' };

export function siteInput(host: string): SiteInput {
  return SITES.find(([re]) => re.test(host))?.[1] ?? GENERIC;
}

export function inputKind(el: Element): InputKind {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return "field";
  if (el.classList.contains("ProseMirror")) return "prosemirror";
  if (el.classList.contains("ql-editor")) return "quill";
  return "contenteditable";
}

const BLOCK = /^(P|DIV|LI|H[1-6]|PRE|BLOCKQUOTE)$/;

/** The plain text of a site's box: one line per paragraph, <br> as a line break. */
export function inputText(el: Element): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  const lines: string[] = [];
  let line = "";
  let open = false;
  const walk = (node: Node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        line += (n as Text).data;
        open = true;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as HTMLElement;
        if (e.tagName === "BR") {
          // a lone <br> only holds an empty paragraph open
          if (e.nextSibling || line) {
            lines.push(line);
            line = "";
          }
          open = true;
          continue;
        }
        if (e.getAttribute("contenteditable") === "false") continue;
        if (BLOCK.test(e.tagName)) {
          if (open) lines.push(line);
          line = "";
          open = false;
          walk(e);
          lines.push(line);
          line = "";
          open = false;
        } else walk(e);
      }
    }
  };
  walk(el);
  if (open) lines.push(line);
  return lines.join("\n").replace(/ /g, " ").replace(/​/g, "");
}
