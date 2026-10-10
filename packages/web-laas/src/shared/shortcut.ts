// Parse the shortcut strings chrome.commands.getAll() returns ("⌥⇧K" on
// macOS, "Alt+Shift+K" elsewhere) so content scripts can match key events.

export interface Chord {
  code: string;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

const NAMED: Record<string, string> = {
  Comma: "Comma", ",": "Comma", Period: "Period", ".": "Period", Space: "Space",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight",
};

function keyToCode(key: string): string | null {
  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return NAMED[key] ?? null;
}

export function parseShortcut(s: string | undefined | null): Chord | null {
  if (!s) return null;
  const c: Chord = { code: "", alt: false, shift: false, ctrl: false, meta: false };
  let key: string;
  if (/[⌘⌥⇧⌃]/.test(s)) {
    c.meta = s.includes("⌘");
    c.alt = s.includes("⌥");
    c.shift = s.includes("⇧");
    c.ctrl = s.includes("⌃");
    key = s.replace(/[⌘⌥⇧⌃]/g, "").trim();
  } else {
    const parts = s.split("+").map((p) => p.trim());
    key = parts.pop() ?? "";
    for (const p of parts) {
      if (p === "Alt" || p === "Option") c.alt = true;
      else if (p === "Shift") c.shift = true;
      else if (p === "Ctrl" || p === "MacCtrl") c.ctrl = true;
      else if (p === "Command" || p === "Cmd" || p === "Meta") c.meta = true;
    }
  }
  const code = keyToCode(key);
  if (!code) return null;
  c.code = code;
  return c;
}

export function matchesChord(e: KeyboardEvent, c: Chord): boolean {
  return (
    e.code === c.code && e.altKey === c.alt && e.shiftKey === c.shift && e.ctrlKey === c.ctrl && e.metaKey === c.meta
  );
}
