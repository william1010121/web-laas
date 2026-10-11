// The formula the caret is in: its LaTeX source (opener and closer excluded),
// where the caret sits inside it, and how it should be rendered.
import { MATH_ENVS, matchClose, mathContext, TEXT_ARG_CMDS } from "./tex";

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

// \end {align} is as good as \end{align}
function endPattern(closer: string): RegExp | null {
  const env = /^\\end\{(.*)\}$/.exec(closer)?.[1];
  return env !== undefined ? new RegExp(`^\\\\end\\s*\\{\\s*${env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`) : null;
}

/** Index of the first unescaped `closer` in `text` (outside % comments when `comments`), or -1. */
function findCloser(text: string, closer: string, comments: boolean): number {
  const endRe = endPattern(closer);
  const closesAt = (i: number) => (endRe ? endRe.test(text.slice(i, i + closer.length + 16)) : text.startsWith(closer, i));
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
      const close = matchClose(text, i + cmd[0].length - 1, comments);
      if (close < 0) return -1;
      i = close;
      continue;
    }
    // \$ is a dollar sign; in \\) the backslashes pair up, so the ) is plain text
    if (!unescaped || !closesAt(i)) continue;
    return i; // for "$", a "$$" right here also ends this formula (it opens the next one)
  }
  return -1;
}

/**
 * The formula around the caret, given the text before it (from any earlier
 * point) and some text after it; null when the caret isn't in math.
 */
export function formulaAt(before: string, after: string, opts: { comments?: boolean } = {}): Formula | null {
  // no formula spans a blank line: start the scan in the caret's paragraph, so an
  // opener left open further up can't swallow this paragraph's delimiters
  let cut = 0;
  for (const m of before.matchAll(/\n[ \t]*\n/g)) cut = m.index + m[0].length;
  if (cut) before = before.slice(cut);
  const ctx = mathContext(before, opts);
  if (!ctx.math || ctx.start === undefined) return null;
  const opener = before.slice(ctx.start - (ctx.openLen ?? 0), ctx.start);
  const { closer, env } = closerFor(opener);
  const found = closer ? findCloser(after, closer, !!opts.comments) : -1;
  // math can't run past a blank line (TeX complains there): a closer beyond one belongs to a later formula
  const blank = after.search(/\n[ \t]*\n/);
  const end = blank >= 0 && (found < 0 || blank < found) ? blank : found >= 0 ? found : after.length;
  const head = before.slice(ctx.start);
  if (/\n[ \t]*\n/.test(head)) return null; // an opener left open in an earlier paragraph
  // the caret inside a % comment: what follows on this line isn't math either
  if (opts.comments && /(^|[^\\])(\\\\)*%/.test(head.slice(head.lastIndexOf("\n") + 1))) return null;
  return { latex: head + after.slice(0, end), caret: head.length, display: ctx.display, env };
}

/** A formula found in a stretch of text: [from, to) spans its delimiters. */
export interface FormulaSpan extends Formula {
  from: number;
  to: number;
}

/**
 * Every formula in `text`, in order. Without `comments` (Markdown sites) a
 * single $ follows Pandoc: no space just inside it, no digit right after the
 * closer, so prices like "$5 and $10" stay text; it doesn't cross a line
 * either, and `code spans` are skipped.
 */
export function findFormulas(text: string, opts: { comments?: boolean } = {}): FormulaSpan[] {
  const comments = !!opts.comments;
  const out: FormulaSpan[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "%" && comments) {
      const nl = text.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === "`" && !comments) {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      const blank = text.slice(i, close < 0 ? n : close).search(/\n[ \t]*\n/);
      if (close >= 0 && blank < 0) {
        i = close + run.length;
        continue;
      }
      i += run.length;
      continue;
    }
    let opener = "";
    if (c === "\\") {
      const m = /^\\(?:[()[\]]|begin\s*\{([^{}\n]*)\})/.exec(text.slice(i, i + 64));
      if (m && (m[1] === undefined || MATH_ENVS.has(m[1].trim()))) opener = m[0];
      else {
        i += /^\\[A-Za-z]+/.exec(text.slice(i, i + 64))?.[0].length ?? 2; // \$, \\ and \command
        continue;
      }
    } else if (c === "$") opener = text[i + 1] === "$" ? "$$" : "$";
    if (!opener) {
      i++;
      continue;
    }
    const span = formulaFrom(text, i, opener, comments);
    if (span) out.push(span);
    i = span ? span.to : i + opener.length;
  }
  return out;
}

/** The formula opened by `opener` at `at`, or null when it isn't closed within its paragraph. */
function formulaFrom(text: string, at: number, opener: string, comments: boolean): FormulaSpan | null {
  const start = at + opener.length;
  const pandoc = opener === "$" && !comments;
  if (pandoc && /^\s|^$/.test(text.slice(start, start + 1))) return null;
  // a formula ends with its paragraph; in Markdown a $…$ one even ends with its line ($10 …\n… $x$)
  const blank = text.slice(start).search(pandoc ? /\n/ : /\n[ \t]*\n/);
  const para = text.slice(start, blank < 0 ? undefined : start + blank);
  const { closer, env } = closerFor(opener);
  for (let from = 0; from < para.length; ) {
    const k = findCloser(para.slice(from), closer, comments);
    if (k < 0) return null;
    const end = from + k;
    if (pandoc && (/\s/.test(para[end - 1]) || /\d/.test(para[end + 1] ?? ""))) {
      from = end + 1;
      continue;
    }
    const len = endPattern(closer)?.exec(para.slice(end))?.[0].length ?? closer.length;
    const latex = para.slice(0, end);
    if (!latex.trim()) return null;
    return { from: at, to: start + end + len, latex, caret: 0, display: opener !== "$" && opener !== "\\(" && env !== "math", env };
  }
  return null;
}
