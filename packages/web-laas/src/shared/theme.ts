// Colour tokens shared by everything web-laas draws inside pages (cheat sheet,
// live preview): light and dark follow the system, one teal accent.
export const LIGHT = {
  "--lw-bg": "#fbfbfa", "--lw-surface": "#ffffff", "--lw-sunken": "#f3f3f1",
  "--lw-fg": "#1d1d1f", "--lw-fg-2": "#3a3a3e", "--lw-muted": "#76767c", "--lw-faint": "#a8a8ad",
  "--lw-line": "#ebebe8", "--lw-line-2": "#dededa",
  "--lw-accent": "#0f766e", "--lw-accent-fg": "#ffffff", "--lw-accent-soft": "#e3f1ef", "--lw-accent-text": "#0f6b64",
  "--lw-key-bg": "#f1f1ee", "--lw-key-fg": "#2c2c30", "--lw-key-line": "#e2e2de",
  "--lw-math": "#141416", "--lw-hover": "#f4f4f1",
  "--lw-extras": "#9a5b12", "--lw-extras-soft": "#f6ecdf", "--lw-user": "#5a4fcf", "--lw-user-soft": "#ecebfb",
  "--lw-shadow-seg": "0 1px 2px rgba(0,0,0,.08), 0 0 0 .5px rgba(0,0,0,.06)",
  "--lw-shadow-pop": "0 12px 32px rgba(20,30,28,.16), 0 0 0 1px rgba(20,30,28,.07)",
};

export const DARK: typeof LIGHT = {
  "--lw-bg": "#18181a", "--lw-surface": "#1e1e21", "--lw-sunken": "#141416",
  "--lw-fg": "#ececef", "--lw-fg-2": "#cfcfd4", "--lw-muted": "#8d8d94", "--lw-faint": "#5f5f66",
  "--lw-line": "#27272b", "--lw-line-2": "#323237",
  "--lw-accent": "#4fb8aa", "--lw-accent-fg": "#0d1514", "--lw-accent-soft": "rgba(79,184,170,.13)", "--lw-accent-text": "#6ccabd",
  "--lw-key-bg": "#26262a", "--lw-key-fg": "#e4e4e8", "--lw-key-line": "#34343a",
  "--lw-math": "#f4f4f6", "--lw-hover": "#202024",
  "--lw-extras": "#e0a764", "--lw-extras-soft": "rgba(224,167,100,.12)", "--lw-user": "#a7a1ff", "--lw-user-soft": "rgba(167,161,255,.13)",
  "--lw-shadow-seg": "0 1px 2px rgba(0,0,0,.4), 0 0 0 .5px rgba(255,255,255,.06)",
  "--lw-shadow-pop": "0 14px 36px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.07)",
};

const block = (sel: string, vars: Record<string, string>) =>
  `${sel} {${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(" ")}}`;

/** CSS declaring the tokens on `selector`, switching with prefers-color-scheme. */
export function themeCss(selector: string): string {
  return `${block(selector, LIGHT)}\n@media (prefers-color-scheme: dark) { ${block(selector, DARK)} }`;
}

/** The accent for the current scheme (for colour inside rendered LaTeX). */
export function accentColor(): string {
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return (dark ? DARK : LIGHT)["--lw-accent"];
}
