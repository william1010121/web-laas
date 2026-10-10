// Port of the cursor movement of Emacs `cdlatex-tab` (cdlatex.el):
// "jump to the next point in a LaTeX text where one would reasonably expect
// that more input can be put in". The cursor stops…
//   - before closing brackets if the preceding char is a bracket or "-"
//     (i.e. inside an empty {} / () / [])
//   - after closing brackets, but not if the following char is one of ({[_^
//   - just after $, if the cursor was before that $
//   - at end of non-empty lines, at the beginning of empty lines
//   - before a SPACE at beginning of line, after the first of several SPACEs
// and it simplifies a^{2} into a^2 when leaving a one-character script.

import { matchOpen } from "./tex";

export interface TabMove {
  /** new caret position, in the coordinates of the text *after* `edit` */
  to: number;
  /** optional edit to apply first (sub/superscript simplification) */
  edit?: { from: number; to: number; insert: string };
}


const OPEN = "([{";
const CLOSE = ")]}";
const NO_STOP_AFTER_CLOSE = /[_^({[]/;

/**
 * Where `cdlatex-tab` would move the cursor from `pos` in `text`.
 * `text` may be a window of the document; positions are relative to it.
 */
export function cdlatexTab(text: string, pos: number, opts: { simplify?: boolean } = {}): TabMove {
  const simplify = opts.simplify ?? true;
  let t = text;
  let p = pos;
  let edit: TabMove["edit"];
  const at = (i: number) => (i >= 0 && i < t.length ? t[i] : "");
  const done = (to: number): TabMove => ({ to, edit });

  // First step, from the character under the cursor.
  const c = at(p);
  if (CLOSE.includes(c) && c !== "") {
    if (simplify && p >= 3 && /^[_^]\{[-+0-9a-zA-Z]\}$/.test(t.slice(p - 3, p + 1))) {
      // x_{2}| → x_2|  (remove the braces around a one-character script)
      edit = { from: p - 2, to: p + 1, insert: t[p - 1] };
      t = t.slice(0, p - 2) + t[p - 1] + t.slice(p + 1);
      p = p - 1;
    } else {
      p += 1;
    }
    // stop after the closing bracket, unless ^_[{( follow
    if (p < t.length && !NO_STOP_AFTER_CLOSE.test(at(p))) return done(p);
  } else if (c === "$") {
    while (at(p) === "$") p++;
    return done(p);
  } else if (c === " ") {
    // stop after the first of many spaces
    p += 1;
    while (p < t.length && t[p] === " ") p++;
    if (p < t.length) p += 1; // re-search-forward "[^ ]" leaves point after the match…
    if (at(p - 1) !== "\n") p -= 1; // …and steps back unless that was a newline
  } else if (p < t.length) {
    p += 1;
  }

  // Move to the next possible stopping site and check out the place.
  for (;;) {
    let q = p;
    while (q < t.length && !" )}\n]".includes(t[q])) q++;
    if (q >= t.length) return done(p);
    const ch = t[q];
    const bol = q === 0 || t[q - 1] === "\n";
    if (ch === " ") {
      // stop at first space, or at beginning of line
      return done(bol ? q : q + 1);
    }
    if (ch === "\n") {
      // stop at line end, but not after \\
      if (bol && q + 1 < t.length) return done(q);
      if (t.slice(q - 2, q) === "\\\\") {
        p = q + 1;
        continue;
      }
      return done(q);
    }
    // ch is ) } ]: stop before it if the preceding char is a bracket or "-"
    const prev = q > 0 ? t[q - 1] : "";
    if (OPEN.includes(prev) || CLOSE.includes(prev) || prev === "-") return done(q);
    p = q + 1;
    // stop after the closing bracket, unless ^_[{( follow
    if (p < t.length && !NO_STOP_AFTER_CLOSE.test(t[p])) return done(p);
  }
}

/**
 * Shift+Tab (cdlatex has no backward move): go to the closest stop before
 * `caret`, where the stops are the places `cdlatexTab` stops at (walking
 * forward from `start`, the beginning of the math region) plus "just inside
 * the end of a group" — the inverse of Tab stepping out of one. So from
 * \frac{x}{y}| it goes to \frac{x}{y|}, then \frac{x|}{y}, then the start.
 */
export function cdlatexBackTab(text: string, caret: number, start: number): number {
  let best = start;
  for (let p = start, guard = 0; guard < 5000; guard++) {
    const to = cdlatexTab(text, p, { simplify: false }).to;
    if (to <= p || to >= caret) break;
    best = p = to;
  }
  for (let q = caret - 1; q > best; q--) {
    if (CLOSE.includes(text[q]) && text[q - 1] !== "\\") return q;
  }
  return best;
}

// ── cdlatex-math-modify ─────────────────────────────────────────────────────

export interface ModifySpec {
  /** e.g. "\\dot", "\\mathbf", or a form with "?" like "\\left( ? \\right)" */
  command: string;
  /** accent-like: \cmd{x}; otherwise a switch: {\cmd x} */
  accent: boolean;
  /** turn i / j into \imath / \jmath under accents */
  rmdot: boolean;
}

export interface ModifyResult {
  /** replace text[from, end) — `end` is where the modifier key sequence starts */
  from: number;
  text: string;
  /** caret offset within `text` */
  caret: number;
}

/**
 * Port of `cdlatex-math-modify`: apply COMMAND to what is before `end`.
 *   - after nothing, a space or any symbol → insert an empty form, cursor
 *     inside (cdlatex only does this after space $ - { ( and otherwise
 *     modifies the symbol itself, e.g. +'b → \mathbf{+}; here 'b works
 *     on its own anywhere)
 *   - after a {group}                   → modify the group
 *   - after a \macro                    → modify the macro
 *   - after a letter: in math only that letter, in text the whole word
 *   - after a digit                     → modify that digit
 */
export function cdlatexModify(text: string, end: number, spec: ModifySpec, inMath: boolean): ModifyResult {
  const { command: cmd, accent } = spec;
  const wrap = (inner: string) => (accent ? `${cmd}{${inner}}` : `{${cmd} ${inner}}`);
  const q = cmd.indexOf("?");
  if (q >= 0) return { from: end, text: cmd.slice(0, q) + cmd.slice(q + 1), caret: q };

  const prev = end > 0 ? text[end - 1] : "";
  if (!/[A-Za-z0-9}]/.test(prev)) {
    const form = accent ? `${cmd}{}` : `{${cmd} }`;
    return { from: end, text: form, caret: form.length - 1 };
  }
  if (prev === "}") {
    const open = matchOpen(text, end - 1);
    if (open >= 0) {
      const group = text.slice(open, end);
      const out = accent ? cmd + group : `{${cmd} ${group.slice(1)}`;
      return { from: open, text: out, caret: out.length };
    }
  }
  let start = end - 1;
  let target = prev;
  if (/[A-Za-z]/.test(prev)) {
    let k = end - 1;
    while (k > 0 && /[A-Za-z]/.test(text[k - 1])) k--;
    if (k > 0 && text[k - 1] === "\\") {
      start = k - 1; // a macro: \alpha
    } else if (!inMath) {
      start = k; // text mode: the whole word
    } else if (spec.rmdot && (prev === "i" || prev === "j")) {
      target = `\\${prev}math`;
    }
    if (start !== end - 1) target = text.slice(start, end);
  }
  const out = wrap(target);
  return { from: start, text: out, caret: out.length };
}
