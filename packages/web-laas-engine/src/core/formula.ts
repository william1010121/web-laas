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

/** Is the character at `i` not escaped (an even number of backslashes before it)? */
function unescapedAt(text: string, i: number): boolean {
  let k = i;
  while (k > 0 && text[k - 1] === "\\") k--;
  return (i - k) % 2 === 0;
}

/**
 * Index of the first unescaped `closer` in `text` within [from, to) (outside
 * % comments when `comments`), or -1. Works in place: no copies of the text.
 */
function findCloser(text: string, closer: string, comments: boolean, from = 0, to = text.length): number {
  const endRe = endPattern(closer);
  const closesAt = (i: number) => (endRe ? endRe.test(text.slice(i, i + closer.length + 16)) : text.startsWith(closer, i));
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (c !== "%" && c !== "\\" && c !== closer[0]) continue;
    const unescaped = unescapedAt(text, i);
    if (comments && c === "%" && unescaped) {
      const nl = text.indexOf("\n", i);
      if (nl < 0 || nl >= to) return -1;
      i = nl; // a comment runs to the end of the line
      continue;
    }
    // \text{… $x$ …}: delimiters inside a text argument belong to nested math, skip the group
    const cmd = unescaped && c === "\\" ? /^\\([A-Za-z]+\*?)\s*\{/.exec(text.slice(i, i + 40)) : null;
    if (cmd && cmd[1] !== "begin" && cmd[1] !== "end" && TEXT_ARG_CMDS.has(cmd[1].replace(/\*$/, ""))) {
      const close = matchClose(text, i + cmd[0].length - 1, comments);
      if (close < 0 || close >= to) return -1;
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

const BLANK_LINE = /\n[ \t]*\n/g;

/** Index of the first match of the global `re` at or after `from`, or -1 (without copying the text). */
function indexFrom(text: string, re: RegExp, from: number): number {
  re.lastIndex = from;
  return re.exec(text)?.index ?? -1;
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
  // the next blank line at or after a position; positions only grow, so each stretch is searched once
  let blankAt = -2;
  const nextBlank = (from: number) => {
    if (blankAt === -1 || blankAt >= from) return blankAt;
    blankAt = indexFrom(text, BLANK_LINE, from);
    return blankAt;
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "%" && comments) {
      const nl = text.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    // a fenced code block (``` or ~~~ opening a line) runs to its closing fence, blank lines and all
    if ((c === "`" || c === "~") && !comments && /^ {0,3}$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i))) {
      let len = 0;
      while (text[i + len] === c) len++;
      // (a backtick fence's info string has no backticks: ```a``` opening a line is inline code)
      const eol = text.indexOf("\n", i);
      const info = text.slice(i + len, eol < 0 ? n : eol);
      if (len >= 3 && !(c === "`" && info.includes("`"))) {
        const mark = c === "`" ? "`" : "~";
        const closer = new RegExp(`\\n {0,3}${mark}{${len},}[ \\t]*(?=\\n|$)`, "g");
        closer.lastIndex = i + len;
        const m = closer.exec(text);
        i = m ? m.index + m[0].length : n; // an unclosed fence runs to the end
        continue;
      }
    }
    if (c === "`" && !comments) {
      let len = 1;
      while (text[i + len] === "`") len++;
      // the closer is a run of exactly as many backticks (``a ``` b`` is one span)
      const run = "`".repeat(len);
      let close = text.indexOf(run, i + len);
      while (close >= 0 && (text[close + len] === "`" || text[close - 1] === "`")) {
        let end = close;
        while (text[end] === "`") end++;
        close = text.indexOf(run, end);
      }
      const blank = nextBlank(i);
      i = close >= 0 && (blank < 0 || blank > close) ? close + len : i + len;
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
    const span = formulaFrom(text, i, opener, comments, nextBlank);
    if (span && "latex" in span) out.push(span);
    // an empty pair ($ $) is no formula, but its closer is no opener either
    i = span ? span.to : i + opener.length;
  }
  return out;
}

/**
 * The formula opened by `opener` at `at`; just its end when it's empty; null
 * when it isn't closed within its paragraph.
 */
function formulaFrom(
  text: string,
  at: number,
  opener: string,
  comments: boolean,
  nextBlank: (from: number) => number,
): FormulaSpan | { to: number } | null {
  const start = at + opener.length;
  const pandoc = opener === "$" && !comments;
  if (pandoc && /^\s|^$/.test(text.slice(start, start + 1))) return null;
  // a formula ends with its paragraph; in Markdown a $…$ one even ends with its line ($10 …\n… $x$)
  const blank = pandoc ? text.indexOf("\n", start) : nextBlank(start);
  const stop = blank < 0 ? text.length : blank;
  const { closer, env } = closerFor(opener);
  const endRe = endPattern(closer);
  for (let from = start; from < stop; ) {
    const end = findCloser(text, closer, comments, from, stop);
    if (end < 0) return null;
    if (pandoc && (/\s/.test(text[end - 1]) || /\d/.test(text[end + 1] ?? ""))) {
      from = end + 1;
      continue;
    }
    const len = endRe?.exec(text.slice(end, end + closer.length + 16))?.[0].length ?? closer.length;
    const latex = text.slice(start, end);
    if (!latex.trim()) return { to: end + len };
    return { from: at, to: end + len, latex, caret: 0, display: opener !== "$" && opener !== "\\(" && env !== "math", env };
  }
  return null;
}
