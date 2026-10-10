// The formula the caret is in: its LaTeX source (opener and closer excluded),
// where the caret sits inside it, and how it should be rendered.
import { matchClose, mathContext, TEXT_ARG_CMDS } from "./tex";

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

/** Index of the first unescaped `closer` in `text` (outside % comments when `comments`), or -1. */
function findCloser(text: string, closer: string, comments: boolean): number {
  for (let i = 0; i < text.length; i++) {
    const unescaped = ESCAPED.test(text.slice(Math.max(0, i - 32), i));
    if (comments && text[i] === "%" && unescaped) {
      const nl = text.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl; // a comment runs to the end of the line
      continue;
    }
    // \text{… $x$ …}: delimiters inside a text argument belong to nested math, skip the group
    const cmd = unescaped && text[i] === "\\" ? /^\\([A-Za-z]+\*?)\s*\{/.exec(text.slice(i, i + 40)) : null;
    if (cmd && cmd[1] !== "begin" && cmd[1] !== "end" && TEXT_ARG_CMDS.has(cmd[1].replace(/\*$/, ""))) {
      const close = matchClose(text, i + cmd[0].length - 1);
      if (close < 0) return -1;
      i = close;
      continue;
    }
    // \$ is a dollar sign; in \\) the backslashes pair up, so the ) is plain text
    if (!text.startsWith(closer, i) || !unescaped) continue;
    return i; // for "$", a "$$" right here also ends this formula (it opens the next one)
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
  let end = closer ? findCloser(after, closer, !!opts.comments) : -1;
  if (end < 0) {
    // unclosed: stop at a blank line, like TeX would complain there
    const blank = after.search(/\n\s*\n/);
    end = blank >= 0 ? blank : after.length;
  }
  const head = before.slice(ctx.start);
  return { latex: head + after.slice(0, end), caret: head.length, display: ctx.display, env };
}
