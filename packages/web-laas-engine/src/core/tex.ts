// Lightweight TeX scanning: is the cursor in math mode, and what is the
// "object" immediately to the left of a position (for \frac / accents).

export interface MathContext {
  math: boolean;
  display: boolean;
  /** where the content of the innermost math region starts (just after its opener) */
  start?: number;
  /** length of that opener ($, $$, \(, \[, \begin{env}) */
  openLen?: number;
}

const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "multline", "multline*", "flalign", "flalign*", "alignat", "alignat*",
  "eqnarray", "eqnarray*", "displaymath", "math", "dmath", "dmath*",
]);

// Commands whose brace argument is text, not math.
const TEXT_ARG_CMDS = new Set([
  "text", "textrm", "textit", "textbf", "textsf", "texttt", "textup", "textnormal",
  "mbox", "hbox", "intertext", "shortintertext", "operatorname", "label", "ref",
  "eqref", "cite", "tag", "begin", "end",
]);

type Frame =
  | { kind: "dollar" | "ddollar" | "paren" | "bracket"; at: number; len: number }
  | { kind: "env"; name: string; at: number; len: number }
  | { kind: "text"; depth: number };

export function mathContext(text: string, opts: { comments?: boolean } = {}): MathContext {
  const stack: Frame[] = [];
  let depth = 0;
  let pendingText = false; // saw \text, waiting for its '{'
  const n = text.length;
  let i = 0;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      const next = text[i + 1];
      if (next === undefined) break;
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < n && /[A-Za-z]/.test(text[j])) j++;
        if (j < n && text[j] === "*") j++;
        const name = text.slice(i + 1, j);
        if (name === "begin" || name === "end") {
          const m = /^\s*\{([^{}\n]*)\}/.exec(text.slice(j));
          if (m) {
            const env = m[1].trim();
            if (MATH_ENVS.has(env)) {
              if (name === "begin") stack.push({ kind: "env", name: env, at: j + m[0].length, len: j + m[0].length - i });
              else {
                const t = top();
                if (t && t.kind === "env" && t.name === env) stack.pop();
              }
            }
            i = j + m[0].length;
            continue;
          }
        }
        if (TEXT_ARG_CMDS.has(name.replace(/\*$/, ""))) pendingText = true;
        i = j;
        continue;
      }
      if (next === "(") stack.push({ kind: "paren", at: i + 2, len: 2 });
      else if (next === "[") stack.push({ kind: "bracket", at: i + 2, len: 2 });
      else if (next === ")" && top()?.kind === "paren") stack.pop();
      else if (next === "]" && top()?.kind === "bracket") stack.pop();
      i += 2;
      continue;
    }
    if (c === "%" && opts.comments) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "{") {
      depth++;
      if (pendingText) stack.push({ kind: "text", depth });
      pendingText = false;
      i++;
      continue;
    }
    if (!/\s/.test(c)) pendingText = false;
    if (c === "}") {
      const t = top();
      if (t && t.kind === "text" && t.depth === depth) stack.pop();
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (c === "$") {
      if (text[i + 1] === "$") {
        if (top()?.kind === "ddollar") stack.pop();
        else stack.push({ kind: "ddollar", at: i + 2, len: 2 });
        i += 2;
      } else {
        if (top()?.kind === "dollar") stack.pop();
        else stack.push({ kind: "dollar", at: i + 1, len: 1 });
        i++;
      }
      continue;
    }
    i++;
  }

  const t = top();
  if (!t || t.kind === "text") return { math: false, display: false };
  const display =
    t.kind === "ddollar" || t.kind === "bracket" || (t.kind === "env" && t.name !== "math");
  return { math: true, display, start: t.at, openLen: t.len };
}

const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

export function matchOpen(text: string, close: number): number {
  const stackChars: string[] = [];
  for (let k = close; k >= 0; k--) {
    const ch = text[k];
    if (k > 0 && text[k - 1] === "\\" && "()[]{}".includes(ch)) continue; // \{ \}
    if (ch in CLOSE_TO_OPEN) stackChars.push(CLOSE_TO_OPEN[ch]);
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (stackChars.pop() !== ch) return -1;
      if (stackChars.length === 0) return k;
    }
  }
  return -1;
}

/**
 * Start index of the TeX object ending at `end`, or null if there is none.
 * Mirrors laas-identify-adjacent-tex-object:
 *   (…) […]        just the bracketed group
 *   {…}{…}         consecutive groups, plus a \macro glued in front
 *   word, \word    letters/digits, plus a leading backslash
 * and the last two extend leftwards over _ ^ . chains (x_{i}^{2}, 3.14).
 */
export function objectStart(text: string, end: number): number | null {
  if (end <= 0) return null;
  const c = text[end - 1];
  const escaped = end >= 2 && text[end - 2] === "\\";
  let start: number;
  if ((c === ")" || c === "]") && !escaped) {
    const s = matchOpen(text, end - 1);
    return s < 0 ? null : s;
  }
  if (c === "}" && !escaped) {
    start = matchOpen(text, end - 1);
    if (start < 0) return null;
    while (start > 0 && text[start - 1] === "}") {
      const s = matchOpen(text, start - 1);
      if (s < 0) break;
      start = s;
    }
    const m = /\\[A-Za-z@*]+$/.exec(text.slice(Math.max(0, start - 64), start));
    if (m) start -= m[0].length;
  } else if (/[A-Za-z0-9]/.test(c)) {
    start = end - 1;
    while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) start--;
    if (start > 0 && text[start - 1] === "\\") start--;
  } else {
    return null;
  }
  if (start > 0 && "_^.".includes(text[start - 1])) {
    const s = objectStart(text, start - 1);
    if (s !== null) start = s;
  }
  return start;
}

/** Strip one pair of brackets that encloses the whole object: (a+b) → a+b. */
export function unwrapObject(obj: string): string {
  if (obj.length >= 2 && ((obj[0] === "(" && obj.endsWith(")")) || (obj[0] === "[" && obj.endsWith("]")))) {
    if (matchOpen(obj, obj.length - 1) === 0) return obj.slice(1, -1);
  }
  return obj;
}
