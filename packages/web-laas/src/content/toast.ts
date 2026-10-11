// Small in-page notification ("web-laas paused") shown when a shortcut is used.
import type { Tone } from "../shared/storage";

const CSS = `
:host { all: initial; }
.toast {
  position: fixed; top: 18px; left: 50%; z-index: 2147483647;
  transform: translate(-50%, -8px); opacity: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px 9px 9px; border-radius: 999px;
  background: rgba(28, 28, 30, .92); color: #f2f2f7;
  box-shadow: 0 10px 30px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.06);
  backdrop-filter: blur(8px);
  font: 500 13.5px/1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif;
  transition: opacity .16s ease, transform .16s ease; pointer-events: none;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.icon { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; color: #fff; font: 17px/1 Georgia, "Times New Roman", serif; }
.on .icon { background: #0f766e; }
.off .icon { background: #8e8e93; }
.info .icon { background: #0f766e; }
.hint { color: #a1a1a6; font-weight: 400; font-size: 12px; }
@media (prefers-color-scheme: light) {
  .toast { background: rgba(255,255,255,.96); color: #1d1d1f; box-shadow: 0 10px 30px rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.06); }
  .hint { color: #6e6e73; }
}
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

let current: { host: HTMLElement; timer: number } | null = null;

export function showToast(text: string, tone: Tone = "info", hint?: string) {
  if (current) {
    clearTimeout(current.timer);
    current.host.remove();
  }
  const host = document.createElement("div");
  host.setAttribute("data-web-laas-toast", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const box = document.createElement("div");
  box.className = `toast ${tone}`;
  box.setAttribute("role", "status");
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = "∑";
  const msg = document.createElement("span");
  msg.textContent = text;
  box.append(icon, msg);
  if (hint) {
    const h = document.createElement("span");
    h.className = "hint";
    h.textContent = hint;
    box.append(h);
  }
  shadow.append(style, box);
  (document.body ?? document.documentElement).append(host);
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("show")));
  const timer = window.setTimeout(() => {
    box.classList.remove("show");
    window.setTimeout(() => host.remove(), 200);
    if (current?.host === host) current = null;
  }, 1800);
  current = { host, timer };
}
