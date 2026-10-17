// In-page cheat sheet overlay. A closed shadow root keeps page CSS out and
// keeps the snippet engine (and page shortcuts) away from its search box.
import type { CheatsheetGroup } from "web-laas-engine";
import { buildCheatsheet, SHEET_CSS, type SheetOptions } from "./sheet";

const HOST_ID = "web-laas-cheatsheet";

const OVERLAY_CSS = `
:host { all: initial; }
.lw-backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  display: grid; place-items: center; padding: 16px;
  background: rgba(12, 12, 14, .42); backdrop-filter: blur(4px) saturate(.9);
  animation: lw-fade .12s ease-out;
}
.lw-panel {
  width: min(1080px, 100%); height: min(800px, 100%);
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 30px 90px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.08);
  animation: lw-pop .14s cubic-bezier(.2,.9,.3,1.2);
}
@keyframes lw-fade { from { opacity: 0 } }
@keyframes lw-pop { from { transform: scale(.97) translateY(6px); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .lw-backdrop, .lw-panel { animation: none; } }
`;

let open: { host: HTMLElement; restore: Element | null; panel: HTMLElement; opts: SheetOptions } | null = null;

function deepActive(): Element | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

export function closeCheatsheet() {
  if (!open) return;
  const { host, restore } = open;
  open = null;
  host.remove();
  if (restore instanceof HTMLElement) restore.focus({ preventScroll: true });
}

/** Show changed snippets in the open cheat sheet (after one was added or deleted there). */
export function refreshCheatsheet(groups: CheatsheetGroup[]) {
  if (!open) return;
  const scroll = open.panel.querySelector(".lw-body")?.scrollTop ?? 0;
  open.panel.replaceChildren(buildCheatsheet(document, groups, { ...open.opts, autofocus: false }));
  const body = open.panel.querySelector(".lw-body");
  if (body) body.scrollTop = scroll;
}

export function toggleCheatsheet(groups: CheatsheetGroup[], opts: Omit<SheetOptions, "onClose" | "autofocus"> & { host: string }) {
  if (open) return closeCheatsheet();
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = SHEET_CSS + OVERLAY_CSS;
  const backdrop = document.createElement("div");
  backdrop.className = "lw-backdrop";
  const panel = document.createElement("div");
  panel.className = "lw-panel";
  const sheetOpts: SheetOptions = { ...opts, onClose: closeCheatsheet, autofocus: true };
  panel.append(buildCheatsheet(document, groups, sheetOpts));
  backdrop.append(panel);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeCheatsheet();
  });
  shadow.append(style, backdrop);
  // Keep typing in the search box away from the page's own shortcuts.
  for (const type of ["keydown", "keyup", "keypress", "input", "beforeinput"]) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  open = { host, restore: deepActive(), panel, opts: sheetOpts };
  (document.body ?? document.documentElement).append(host);
}
