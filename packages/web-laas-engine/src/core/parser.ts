// A tiny parser for the snippet config language: a JavaScript object-literal
// subset (comments, unquoted keys, trailing commas, '/regex/flags' literals,
// '…' / "…" strings with JS escapes, `…` raw strings). No eval, so it works
// under MV3 and strict page CSPs.

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${message} (line ${line}, col ${col})`);
  }
}

export function parseConfigText(src: string): unknown {
  let i = 0;

  const fail = (msg: string, at = i): never => {
    const before = src.slice(0, at);
    const line = before.split("\n").length;
    const col = at - before.lastIndexOf("\n");
    throw new ParseError(msg, line, col);
  };

  const skip = () => {
    for (;;) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") i++;
      else if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) fail("unterminated comment");
        i = end + 2;
      } else return;
    }
  };

  const parseString = (): string => {
    const q = src[i++];
    let out = "";
    if (q === "`") {
      // raw string: only \` is an escape
      for (;;) {
        if (i >= src.length) fail("unterminated `string`");
        const c = src[i++];
        if (c === "`") return out;
        if (c === "\\" && src[i] === "`") {
          out += "`";
          i++;
        } else out += c;
      }
    }
    for (;;) {
      if (i >= src.length) fail("unterminated string");
      const c = src[i++];
      if (c === q) return out;
      if (c === "\n") fail("newline in string (use \\n or a `raw string`)", i - 1);
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = src[i++];
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "0": out += "\0"; break;
        case "\n": break;
        case "x": {
          const h = src.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(h)) fail("bad \\x escape");
          out += String.fromCharCode(parseInt(h, 16));
          i += 2;
          break;
        }
        case "u": {
          if (src[i] === "{") {
            const end = src.indexOf("}", i);
            out += String.fromCodePoint(parseInt(src.slice(i + 1, end), 16));
            i = end + 1;
          } else {
            const h = src.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("bad \\u escape");
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
          }
          break;
        }
        default: out += e;
      }
    }
  };

  const parseRegex = (): RegExp => {
    const start = i++;
    let inClass = false;
    for (;;) {
      if (i >= src.length || src[i] === "\n") fail("unterminated regex", start);
      const c = src[i++];
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
    }
    const body = src.slice(start + 1, i - 1);
    const fm = /^[a-z]*/.exec(src.slice(i))![0];
    i += fm.length;
    try {
      return new RegExp(body, fm);
    } catch (e) {
      return fail(`invalid regex /${body}/: ${(e as Error).message}`, start);
    }
  };

  const parseValue = (): unknown => {
    skip();
    const c = src[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"' || c === "'" || c === "`") return parseString();
    if (c === "/") return parseRegex();
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] === "true") return true;
      if (word[0] === "false") return false;
      if (word[0] === "null") return null;
      fail(`unexpected identifier '${word[0]}'`, i - word[0].length);
    }
    return fail(i >= src.length ? "unexpected end of input" : `unexpected character '${c}'`);
  };

  const parseArray = (): unknown[] => {
    i++;
    const arr: unknown[] = [];
    for (;;) {
      skip();
      if (src[i] === "]") {
        i++;
        return arr;
      }
      arr.push(parseValue());
      skip();
      if (src[i] === ",") i++;
      else if (src[i] !== "]") fail("expected ',' or ']'");
    }
  };

  const parseObject = (): Record<string, unknown> => {
    i++;
    const obj: Record<string, unknown> = {};
    for (;;) {
      skip();
      if (src[i] === "}") {
        i++;
        return obj;
      }
      let key: string;
      if (src[i] === '"' || src[i] === "'" || src[i] === "`") key = parseString();
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
        if (!m) fail("expected property name");
        key = m![0];
        i += key.length;
      }
      skip();
      if (src[i] !== ":") fail("expected ':'");
      i++;
      obj[key] = parseValue();
      skip();
      if (src[i] === ",") i++;
      else if (src[i] !== "}") fail("expected ',' or '}'");
    }
  };

  const v = parseValue();
  skip();
  if (i < src.length) fail("unexpected trailing content");
  return v;
}
