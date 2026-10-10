// Replacement templates:
//   $1 / ${1} / ${1:default}  tabstops ($0 = final cursor position)
//   [[0]] [[1]] …             regex capture groups (0 = first group)
//   ${PREV}                   the TeX object left of the trigger (option "o")
// Any other '$' is a literal dollar sign, so "$$0$" means "$|$".

export type TemplateToken =
  | { kind: "text"; text: string }
  | { kind: "stop"; n: number; def: string }
  | { kind: "capture"; n: number }
  | { kind: "var"; name: string };

export function tokenizeTemplate(src: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "$") {
      const digits = /^\$(\d+)/.exec(src.slice(i));
      if (digits) {
        flush();
        out.push({ kind: "stop", n: Number(digits[1]), def: "" });
        i += digits[0].length;
        continue;
      }
      const brace = /^\$\{(\d+)(?::|\})/.exec(src.slice(i));
      if (brace) {
        flush();
        const n = Number(brace[1]);
        i += brace[0].length;
        let def = "";
        if (brace[0].endsWith(":")) {
          // read default up to the matching '}'
          let depth = 0;
          while (i < src.length) {
            const d = src[i];
            if (d === "\\" && i + 1 < src.length) {
              def += d + src[i + 1];
              i += 2;
              continue;
            }
            if (d === "{") depth++;
            else if (d === "}") {
              if (depth === 0) break;
              depth--;
            }
            def += d;
            i++;
          }
          i++; // closing brace
        }
        out.push({ kind: "stop", n, def });
        continue;
      }
      const v = /^\$\{([A-Za-z_]\w*)\}/.exec(src.slice(i));
      if (v) {
        flush();
        out.push({ kind: "var", name: v[1] });
        i += v[0].length;
        continue;
      }
    } else if (c === "[" && src[i + 1] === "[") {
      const m = /^\[\[(\d+)\]\]/.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ kind: "capture", n: Number(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

export interface Range {
  start: number;
  end: number;
}

export interface Rendered {
  text: string;
  /** tabstops in visit order; the last one is always $0 */
  stops: Range[];
}

export function renderTemplate(
  tokens: TemplateToken[],
  captures: string[],
  vars: Record<string, string>,
): Rendered {
  let text = "";
  const byNum = new Map<number, Range>();
  for (const t of tokens) {
    if (t.kind === "text") text += t.text;
    else if (t.kind === "capture") text += captures[t.n] ?? "";
    else if (t.kind === "var") text += vars[t.name] ?? "${" + t.name + "}";
    else {
      const start = text.length;
      text += t.def;
      if (!byNum.has(t.n)) byNum.set(t.n, { start, end: text.length });
    }
  }
  const nums = [...byNum.keys()].filter((n) => n > 0).sort((a, b) => a - b);
  const stops = nums.map((n) => byNum.get(n)!);
  stops.push(byNum.get(0) ?? { start: text.length, end: text.length });
  return { text, stops };
}
