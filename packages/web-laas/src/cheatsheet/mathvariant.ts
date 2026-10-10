// Chrome's MathML Core only honours mathvariant="normal". KaTeX marks
// \mathbb, \mathcal, \mathbf… with mathvariant, so map those letters to the
// Unicode Mathematical Alphanumeric Symbols instead.

type Variant = { upper?: number; lower?: number; digit?: number; holes?: Record<string, string> };

const VARIANTS: Record<string, Variant> = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
  italic: { upper: 0x1d434, lower: 0x1d44e, holes: { h: "ℎ" } },
  "bold-italic": { upper: 0x1d468, lower: 0x1d482 },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    holes: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" },
  },
  "bold-script": { upper: 0x1d4d0, lower: 0x1d4ea },
  fraktur: { upper: 0x1d504, lower: 0x1d51e, holes: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" } },
  "double-struck": {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    holes: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
  },
  "bold-fraktur": { upper: 0x1d56c, lower: 0x1d586 },
  "sans-serif": { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  "bold-sans-serif": { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
};

function mapChar(ch: string, v: Variant): string {
  if (v.holes?.[ch]) return v.holes[ch];
  const c = ch.charCodeAt(0);
  if (c >= 65 && c <= 90 && v.upper) return String.fromCodePoint(v.upper + c - 65);
  if (c >= 97 && c <= 122 && v.lower) return String.fromCodePoint(v.lower + c - 97);
  if (c >= 48 && c <= 57 && v.digit) return String.fromCodePoint(v.digit + c - 48);
  return ch;
}

/** Rewrite <mi|mn|mtext mathvariant="…">text</…> into plain Unicode math letters. */
export function fixMathvariants(mathml: string): string {
  return mathml.replace(
    /<(mi|mn|mtext) mathvariant="([a-z-]+)">([^<]*)<\/\1>/g,
    (m, tag: string, variant: string, text: string) => {
      const v = VARIANTS[variant];
      if (!v) return m;
      const mapped = [...text].map((ch) => mapChar(ch, v)).join("");
      return `<${tag} mathvariant="normal">${mapped}</${tag}>`;
    },
  );
}
