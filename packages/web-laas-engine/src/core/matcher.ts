import type { Snippet } from "./config";
import { renderTemplate, type Rendered } from "./template";
import { mathContext, objectStart, unwrapObject, type MathContext } from "./tex";
import { cdlatexModify } from "./cdlatex";

export interface Expansion {
  snippet: Snippet;
  /** replace text[from, caret) with rendered.text */
  from: number;
  /** the text being replaced (for undo-by-backspace) */
  original: string;
  rendered: Rendered;
  /**
   * laas "auto space": a plain expansion that starts with a backslash
   * (e.g. \alpha) — callers may add a space after it unless ) or ] follows.
   */
  autoSpace: boolean;
}

export interface MatchOptions {
  auto: boolean;
  latexComments?: boolean;
}

const REGEX_WINDOW = 300;

/**
 * Find the best snippet to expand given the text before the caret.
 * `before` is the text from some earlier point up to the caret; its start
 * is treated as the start of the document for math-mode detection.
 */
export function findExpansion(
  snippets: Snippet[],
  before: string,
  opts: MatchOptions,
  ctx?: MathContext,
): Expansion | null {
  let context = ctx;
  const getCtx = () => (context ??= mathContext(before, { comments: opts.latexComments }));
  const tail = before.slice(-REGEX_WINDOW);
  const tailOffset = before.length - tail.length;

  let best: { s: Snippet; start: number; captures: string[]; len: number; math: boolean } | null = null;

  for (const s of snippets) {
    if (s.auto !== opts.auto) continue;
    let start: number;
    let captures: string[] = [];
    if (s.trigger !== null) {
      if (!before.endsWith(s.trigger)) continue;
      start = before.length - s.trigger.length;
    } else {
      const m = s.regex!.exec(tail);
      if (!m) continue;
      start = tailOffset + m.index;
      captures = m.slice(1).map((x) => x ?? "");
    }
    const len = before.length - start;
    if (len === 0) continue;

    // Compare before doing the more expensive checks.
    if (
      best &&
      (s.priority < best.s.priority ||
        (s.priority === best.s.priority && len <= best.len))
    )
      continue;

    const first = before[start];
    // Never right after a backslash (laas--no-backslash-before-point?).
    if (start > 0 && before[start - 1] === "\\") continue;
    // A trigger starting with a letter never fires while typing a \command.
    if (/[A-Za-z]/.test(first) && /\\[A-Za-z]*$/.test(before.slice(Math.max(0, start - 40), start)))
      continue;
    if (s.wordBoundary && start > 0 && /[A-Za-z0-9]/.test(before[start - 1])) continue;

    const c = getCtx();
    const ok = c.math ? (c.display ? s.mode.display : s.mode.inline) : s.mode.text;
    if (!ok) continue;

    let objStart = start;
    if (s.needsObject) {
      const o = objectStart(before, start);
      if (o === null) continue;
      objStart = o;
    }
    best = { s, start: objStart, captures, len, math: c.math };
  }

  if (!best) return null;
  if (best.s.modify) {
    // cdlatex-math-modify: computed from what precedes the trigger
    const end = before.length - best.len;
    const m = cdlatexModify(before, end, best.s.modify, best.math);
    return {
      snippet: best.s,
      from: m.from,
      original: before.slice(m.from),
      rendered: { text: m.text, stops: [{ start: m.caret, end: m.caret }] },
      autoSpace: false,
    };
  }
  const prev = before.slice(best.start, before.length - best.len);
  const rendered = renderTemplate(best.s.template, best.captures, { PREV: prev, PREV_INNER: unwrapObject(prev) });
  // laas's auto space belongs to aas snippets, not to cdlatex's insertions
  const plain =
    best.s.source !== "cdlatex" && !best.s.needsObject && best.s.template.every((t) => t.kind !== "stop");
  return {
    snippet: best.s,
    from: best.start,
    original: before.slice(best.start),
    rendered,
    autoSpace: plain && rendered.text.startsWith("\\"),
  };
}
