# web-laas-engine

[![npm](https://img.shields.io/npm/v/web-laas-engine.svg)](https://www.npmjs.com/package/web-laas-engine)
[![license](https://img.shields.io/npm/l/web-laas-engine.svg)](https://github.com/william1010121/web-laas/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/web-laas-engine.svg)](https://www.npmjs.com/package/web-laas-engine)

**LaTeX auto-activating snippets for any web editor** — a faithful port of Emacs
[laas](https://github.com/tecosaur/LaTeX-auto-activating-snippets) and
[cdlatex](https://github.com/cdominik/cdlatex), with yasnippet-style tabstops.

Type `;a` → `\alpha`, `x/` → `\frac{x}{}`, `x1` → `x_1`, `` `a `` → `\alpha`,
`ab'.` → `a\dot{b}`, and press <kbd>Tab</kbd> to move through fields and out of groups, just like in Emacs.

It works on the editors the web actually uses:

| Editor | Where you meet it |
|---|---|
| CodeMirror 6 | Overleaf, JupyterLab, Notebook 7 |
| CodeMirror 5 | HackMD, classic Jupyter |
| ProseMirror / contenteditable | ChatGPT, Claude, Notion, Lexical… |
| `<textarea>` / `<input>` | GitHub, StackExchange, any form |
| anything else | plug in your own adapter |

This is the engine behind the [web-laas browser extension](https://github.com/william1010121/web-laas).
It has no dependencies and no browser-extension APIs.

## Install

```sh
npm install web-laas-engine
```

Or drop it into any page:

```html
<script src="https://unpkg.com/web-laas-engine/dist/web-laas-engine.auto.js"></script>
<!-- window.webLaas is the controller -->
```

## Usage

### Turn it on for a page

```ts
import { LaasController } from "web-laas-engine/dom";

const laas = new LaasController();
laas.attach(); // listens on window, built-in snippets

laas.setState({
  configText: `{
    snippets: [
      { trigger: "beg", replacement: \`\\begin{$1}
	$0
\\end{$1}\`, options: "tA" },
    ],
  }`,
});
laas.setState({ prefs: { autoSpace: false } }); // behaviour switches
laas.setState({ enabled: false });              // pause
laas.detach();                                  // remove all listeners
```

`ControllerOptions`:

| Option | Default | |
|---|---|---|
| `window` | `window` | window to listen on (e.g. an iframe's) |
| `host` | `location.hostname` | used for `sites` / `excludeSites` / `disabledSites` |
| `filter` | all | `(el) => boolean` — only handle some elements |
| `adapters` | `[]` | custom `AdapterFactory`s, tried before the built-ins |
| `onConfigError` | `console.warn` | called when the config fails to compile (built-ins are used) |
| `onFormula` | — | live-preview hook: `(f: FormulaState \| null) => void`, called when the formula under the caret or its position on screen changes |

### Live preview

```ts
const laas = new LaasController({
  onFormula: (f) => {
    // f: { latex, caret, display, env?, rect: { left, top, bottom } | null } — or null outside math
    f ? showPreview(f.latex, f.caret, f.rect) : hidePreview();
  },
});
laas.attach();
laas.refreshFormula(); // report the current state again (e.g. once your preview UI is ready)
```

Every built-in adapter implements `caretRect()` (textarea/input via a mirror element, contenteditable via the
selection, CodeMirror via its own coordinates); add it to a custom adapter to place a preview there too.
`formulaAt(before, after)` is the pure version: the formula around a caret, from the text on either side.

### Behaviour switches (`prefs`)

All default to `true` (`DEFAULT_PREFS`).

| Pref | |
|---|---|
| `tabJump` | yasnippet-style fields: <kbd>Tab</kbd> at the end of a field goes to the next one, then to `$0`; nested snippets stack |
| `tabOut` | <kbd>Tab</kbd> moves like Emacs `cdlatex-tab` (out of groups, into the next empty `{}`, past `$`); <kbd>Shift</kbd>+<kbd>Tab</kbd> walks back. In math, focus never leaves the editor |
| `simplifyScripts` | leaving a one-character script simplifies it: `x_{2}` → `x_2` |
| `backspaceUndo` | <kbd>Backspace</kbd> right after an expansion restores what you typed |
| `autoSpace` | laas auto space: `\alpha` gets a trailing space unless `)` or `]` follows |
| `extras` | web extras: `mk`, `dm`, `sum`, `lim`, `bmat`, … |
| `cdlatex` | cdlatex tables: `` ` `` symbols, `'` modifiers, `_` `^` braces, <kbd>Tab</kbd> commands |
| `autoPair` | cdlatex pairs: `$` → `$|$` in text, `[` `{` in math; typing a closer steps over it |

### Custom editors

```ts
import { LaasController, type EditorAdapter } from "web-laas-engine/dom";

const monaco = (el: Element): EditorAdapter | null => {
  const editor = findMyMonacoEditor(el);
  if (!editor) return null;
  return {
    kind: "monaco",
    id: editor,
    getSelection: () => /* { from, to } as UTF-16 offsets */,
    getLength: () => editor.getModel().getValueLength(),
    textBefore: (pos, max) => /* text in [pos - max, pos) */,
    slice: (from, to) => /* … */,
    replace: (from, to, text, selFrom, selTo) => { /* edit, then select */ },
    setSelection: (from, to) => { /* … */ },
  };
};
new LaasController({ adapters: [monaco] }).attach();
```

### Core only (no DOM)

```ts
import { compileConfig, snippetsForHost, findExpansion, cdlatexTab } from "web-laas-engine";

const { config } = compileConfig(userText);           // ParseError carries line/column
const snippets = snippetsForHost(config, "www.overleaf.com");
findExpansion(snippets, "$x/", { auto: true });
// → { from: 1, rendered: { text: "\\frac{x}{}", stops: [...] }, ... }

cdlatexTab("\\frac{a}{}", 7); // → { to: 9 } — into the empty denominator
```

Also exported: `parseConfigText`, `mathContext`, `objectStart`, `cdlatexBackTab`, `cdlatexModify`,
`cheatsheetEntries`, `groupCheatsheet`, `previewLatex`, `tokenizeTemplate`, `renderTemplate`, `hostMatches`,
and the built-in sets `DEFAULT_CONFIG_TEXT`, `EXTRAS_CONFIG_TEXT`, `CDLATEX_CONFIG_TEXT`.

## Built-in snippets

Precedence: **yours > cdlatex > web extras > laas**. A higher set hides a lower set's snippet with
the same trigger — as in Emacs, where cdlatex grabs `'` and `_` before laas ever sees them.

### laas — `src/core/defaults.laas`

A one-to-one port of laas.el: basic symbols (`!=` `->` `<=` `iff` `inn` `xx` …), function names
(`sin` `log` `max` …), the `;` / `;;` / `;;;` table, auto subscripts (`x1` `xii` `xip1`, `x_1`+`2` → `x_{12}`),
the smart fraction (`//`, `x/`, `(a+b)/` → `\frac{a+b}{}`), accents (`'.` `hat` `bar` `.. ` …),
and laas's global rules (no expansion right after `\`, auto space).

| Deliberate difference | laas.el | here | why |
|---|---|---|---|
| `CC` `RR` `ZZ` … | `\CC` macros | `\CC` on Overleaf, `\mathbb{C}` elsewhere | KaTeX/MathJax don't define them |
| text-mode `'b` `'i` … | every LaTeX buffer | Overleaf only | avoids *they'r* misfires |
| while typing a `\command` | checks one char | never inside a `\command` | `\arcsin` stays `\arcsin` |

### cdlatex — `src/core/cdlatex.laas`

Generated from cdlatex.el's default tables by `scripts/gen-cdlatex.mjs`:

- `` ` ``+key → math symbol, `` `` `` for level 2, … (`` `a `` `\alpha`, ` ``e ` `\varepsilon`, ` ```e ` `\exp`)
- `'`+key → `cdlatex-math-modify`: only the last letter in math (`ab'.` → `a\dot{b}`), whole macros and
  `{groups}`, an empty `\dot{}` when there's nothing to modify, `i`/`j` → `\imath`/`\jmath`
- `_` `^` → `_{|}` `^{|}`; twice → `_{\mathrm{|}}`
- <kbd>Tab</kbd> commands: `fr` `sq` `lr(` `intl` `suml` `caseeq` `qq` … (math) and `equ` `ali` `ite` `enu` `sn` `fn` …
  (document, Overleaf only); the cursor lands on cdlatex's `?`, then <kbd>Tab</kbd> walks the empty groups
- not ported (they need reftex or a prompt): `pref` `ref` `lbl` `cte` `cite{` `beg` `env`

Regenerate: `emacs --batch -l scripts/dump-cdlatex.el > scripts/cdlatex-defaults.json && node scripts/gen-cdlatex.mjs`.

### Web extras — `src/core/extras.laas`

`mk` (`$|$`, <kbd>Tab</kbd> leaves it), `dm` (`\[…\]` on Overleaf, `$$…$$` elsewhere), and
`__` `td` `ee` `set` `norm` `abs` `ceil` `floor` `part` `sum` `prod` `lim` `int` `bmat` `pmat` `case` ….

## Config language

A subset of JavaScript object literals — comments, trailing commas, `/regex/flags`,
and `` `raw strings` `` (no need to double backslashes). It is parsed, never `eval`ed, so it works under
MV3 and strict page CSPs.

```js
{
  useDefaults: true,                  // keep the built-in sets
  removeDefaults: ["oo"],             // drop built-ins by trigger
  disabledSites: ["mail.google.com"],
  latexCommentSites: ["overleaf.com"],// % starts a comment there
  variables: { GREEK: "alpha|beta" }, // ${GREEK} inside regex triggers
  snippets: [
    { trigger: "mk", replacement: "$$1$$0", options: "tAw" },
    { trigger: /([a-z])hat/, replacement: `\hat{[[0]]}`, options: "mA" },
    { trigger: "/", replacement: `\frac{${PREV_INNER}}{$1}$0`, options: "mAo" },
    { group: "Mine", options: "mA", sites: ["overleaf.com"], snippets: [
      { trigger: "qq", replacement: `\quad`, description: "space" },
    ] },
  ],
}
```

- **options**: `t` text · `m` math · `n` inline math · `M` display math · `A` auto-expand (otherwise <kbd>Tab</kbd>) ·
  `r` the trigger string is a regex · `w` not after a letter/digit · `o` needs a TeX object on the left
- **templates**: `$1`, `${1:default}`, `$0` tabstops · `[[n]]` regex groups · `${PREV}` the object on the left,
  `${PREV_INNER}` without outer `()`/`[]` · any other `$` is a literal dollar
- **groups**: `{ group, options, sites, excludeSites, priority, snippets: [...] }` pass their fields down, nestable
- **cheat sheet**: `description`, and `preview` (LaTeX to render)
- **cdlatex modifiers**: `{ trigger: "'.", action: "cdlatex-modify", command: "\\dot", accent: true, rmdot: true }`
- **priority**: higher wins, then the longer trigger, then the earlier one

## Development

```sh
npm run build        # dist/: ESM (index.js, dom.js), types, web-laas-engine.auto.js
npm test             # vitest: core + controller on jsdom
npm run serve:test   # http://localhost:8765/test/editor/ — 5 real editors
ego-browser nodejs < test/editor/e2e.ego.mjs   # types into every one of them
```

## License

[GPL-3.0-or-later](https://github.com/william1010121/web-laas/blob/main/LICENSE) — the snippet tables are ported
from [laas](https://github.com/tecosaur/LaTeX-auto-activating-snippets) (© TEC, GPL-3.0+) and
[cdlatex](https://github.com/cdominik/cdlatex) (© Carsten Dominik, GPL-3.0+), so this project shares their license.
