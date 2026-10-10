// The formula the caret is in: its LaTeX source (opener and closer excluded),
// where the caret sits inside it, and how it should be rendered.
import { mathContext } from "./tex";

export interface Formula {
  /** LaTeX between the delimiters */
  latex: string;
  /** caret offset within `latex` */
  caret: number;
  /** display math ($$, \[, equation, align…) rather than inline */
  display: boolean;
  /** the enclosing environment for \begin{env} math (align, gather, …) */
  env?: string;
}

const ESCAPED = /(^|[^\\])(\\\\)*$/; // an even number of backslashes before a position

function closerFor(opener: string): { closer: string; env?: string } {
  if (opener === "$$") return { closer: "$$" };
  if (opener === "$") return { closer: "$" };
  if (opener === "\\(") return { closer: "\\)" };
  if (opener === "\\[") return { closer: "\\]" };
  const env = /^\\begin\s*\{([^}]*)\}$/.exec(opener)?.[1]?.trim();
  return { closer: env ? `\\end{${env}}` : "", env };
}

/** Index of the first unescaped `closer` in `text`, or -1. */
function findCloser(text: string, closer: string): number {
  for (let i = text.indexOf(closer); i >= 0; i = text.indexOf(closer, i + 1)) {
    const escaped = closer[0] === "$" && !ESCAPED.test(text.slice(0, i));
    if (escaped) continue;
    if (closer === "$" && text[i + 1] === "$") return i; // "$$" opens the next formula: stop here
    return i;
  }
  return -1;
}

/**
 * The formula around the caret, given the text before it (from any earlier
 * point) and some text after it; null when the caret isn't in math.
 */
export function formulaAt(before: string, after: string, opts: { comments?: boolean } = {}): Formula | null {
  const ctx = mathContext(before, opts);
  if (!ctx.math || ctx.start === undefined) return null;
  const opener = before.slice(ctx.start - (ctx.openLen ?? 0), ctx.start);
  const { closer, env } = closerFor(opener);
  let end = closer ? findCloser(after, closer) : -1;
  if (end < 0) {
    // unclosed: stop at a blank line, like TeX would complain there
    const blank = after.search(/\n\s*\n/);
    end = blank >= 0 ? blank : after.length;
  }
  const head = before.slice(ctx.start);
  return { latex: head + after.slice(0, end), caret: head.length, display: ctx.display, env };
}
