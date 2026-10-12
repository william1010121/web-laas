<h1 align="center">∑ web-laas</h1>

<p align="center"><b>Emacs-grade LaTeX snippets for every editor on the web.</b><br>
Type <code>;a</code> → <code>\alpha</code>, <code>x/</code> → <code>\frac{x}{}</code>, <code>`a</code> → <code>\alpha</code>, <code>ab'.</code> → <code>a\dot{b}</code> — on Overleaf, ChatGPT, Claude, Notion, HackMD and Jupyter.</p>

<p align="center">
  <a href="https://github.com/william1010121/web-laas/actions/workflows/ci.yml"><img src="https://github.com/william1010121/web-laas/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/web-laas-engine"><img src="https://img.shields.io/npm/v/web-laas-engine.svg?label=web-laas-engine" alt="npm"></a>
  <a href="https://github.com/william1010121/web-laas/releases/latest"><img src="https://img.shields.io/github/v/release/william1010121/web-laas?label=extension" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="license"></a>
</p>

<p align="center">
  <a href="https://william1010121.github.io/web-laas/">Live demo</a> ·
  <a href="#install">Install</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#keys">Keys</a> ·
  <a href="#your-own-snippets">Your own snippets</a> ·
  <a href="packages/web-laas-engine">Engine (npm)</a>
</p>

<p align="center">
  <a href="docs/demo.mp4"><img src="docs/demo.gif" width="800" alt="web-laas demo: typing $, ;a, sr, `b, x1/, sq⇥, sum, x'. and _ in an Overleaf-style editor — the keys pressed are shown underneath, the formula renders live"></a>
  <br><sub>Every editor state in this video comes from the real engine. <a href="docs/demo.mp4">1080p MP4</a> · <a href="demo">video source (HyperFrames)</a></sub>
</p>

---

If you write math in Emacs with [laas](https://github.com/tecosaur/LaTeX-auto-activating-snippets) and
[cdlatex](https://github.com/cdominik/cdlatex), every web editor feels slow. **web-laas** brings the same snippets — ported
one-to-one from the Emacs packages, not approximated — and the same <kbd>Tab</kbd> behaviour (yasnippet fields +
`cdlatex-tab`) to the browser.

## What you get

- **laas, faithfully.** All 218 laas.el snippets: `;a` `;;e` `;;;e` greek and symbols, `!=` `->` `<=` `iff` `inn`,
  auto subscripts (`x1` → `x_1`, `xii` → `x_i`, `x_1`+`2` → `x_{12}`), the smart fraction (`x/`, `(a+b)/`, `//`) and accents.
- **cdlatex, too.** `` `a `` symbol levels, `'` modifiers (`ab'.` → `a\dot{b}`, `'b` → `\mathbf{}`), `_` → `_{}`,
  <kbd>Tab</kbd> commands (`fr⇥` `sq⇥` `lr(⇥` `equ⇥`), and `$ [ {` pairing.
- **Tab that knows LaTeX.** Fields like yasnippet, nested snippets, and cdlatex's movement: out of a group, into the next
  empty `{}`, past `$`. <kbd>Shift</kbd>+<kbd>Tab</kbd> walks back. Inside math, focus never jumps to another button.
- **Works where you write.** CodeMirror 6 (Overleaf, JupyterLab), CodeMirror 5 (HackMD), ProseMirror (ChatGPT, Claude),
  contenteditable (Notion) and plain text fields — including input methods like Zhuyin and Pinyin.
- **See what you're editing.** A small floating preview renders the formula under the caret as you type, with the caret
  marked and empty fields shown as □ — above the caret, below it, or in the corner (your choice). It follows your
  light/dark theme; <kbd>Esc</kbd> hides it until you type again.
- **Read it typeset.** Formulas the caret isn't in are drawn rendered, right over their LaTeX source; move the caret
  into one (or click it) and the source is back. On ChatGPT, Claude and Gemini the messages you've sent are typeset
  too (copying them still gives the LaTeX). Turn it off in the settings page.
- **Your delimiters, per site.** Pick what ` mk` and ` dm` insert right in the toolbar popup — `$…$` or `\(…\)`,
  `$$…$$`, `\[…\]`, `equation*` or `align*` — and each site remembers its own choice.
- **A cheat sheet one key away.** <kbd>⌥</kbd><kbd>⇧</kbd><kbd>K</kbd> shows every snippet available on the current site,
  searchable, with the math rendered.
- **Yours to configure.** Write snippets like an Emacs config, try them in a live playground, turn sets on and off.

## Install

**Chrome / Arc / Edge / Brave** (any Chromium browser):

1. Download `web-laas-extension-v*.zip` from the [latest release](https://github.com/william1010121/web-laas/releases/latest) and unzip it.
2. Open `chrome://extensions` (Arc: `arc://extensions`), turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Type ` mk` in any text box — it becomes `$|$`. Then try `;a`.

Or build it yourself:

```sh
git clone https://github.com/william1010121/web-laas && cd web-laas
npm install && npm run build      # → packages/web-laas/dist
```

Using the engine in your own app instead? → [`web-laas-engine` on npm](packages/web-laas-engine).

## Keys

| Key | |
|---|---|
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>K</kbd> | cheat sheet for this site |
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>L</kbd> | turn expansion on / off (a toast tells you which) |
| <kbd>Tab</kbd> | expand a Tab snippet → move within the field (cdlatex) → next field → leave the snippet |
| <kbd>⇧</kbd><kbd>Tab</kbd> | back: inside a group's end, the previous field, the start of the formula |
| <kbd>⌫</kbd> | right after an expansion: undo it |

A taste of what expands (in math):

| You type | You get | | You type | You get |
|---|---|---|---|---|
| `;a` `;;e` `;8` | `\alpha` `\varepsilon` `\infty` | | `` `a `` ` ``e ` ` ```e ` | `\alpha` `\varepsilon` `\exp` |
| `x1` `xii` `xip1` | `x_1` `x_i` `x_{i+1}` | | `ab'.` `x'b` `'b` | `a\dot{b}` `\mathbf{x}` `\mathbf{}` |
| `x/` `(a+b)/` `//` | `\frac{x}{}` `\frac{a+b}{}` `\frac{}{}` | | `fr⇥` `sq⇥` `lr(⇥` | `\frac{}{}` `\sqrt{}` `\left( \right)` |
| `sr` `cb` `invs` | `^2` `^3` `^{-1}` | | `x_` `x__` | `x_{}` `x_{\mathrm{}}` |
| `->` `<=` `!=` `iff` | `\to` `\leq` `\neq` `\iff` | | `sum` `lim` `bmat` | `\sum_{}^{}` `\lim_{n \to \infty}` `\begin{bmatrix}…` |

And in text: ` mk` → `$|$`, ` dm` → display math, `$` → `$|$`.
The full list lives in the extension's cheat sheet.

## Your own snippets

Settings → **Snippet editor**. The format is a JavaScript object literal (parsed, never `eval`ed):

```js
{
  snippets: [
    { trigger: "beg", replacement: `\begin{$1}
	$0
\end{$1}`, options: "tA" },
    { trigger: /([a-z])tld/, replacement: `\tilde{[[0]]}`, options: "mA" },
    { group: "Probability", options: "mA", snippets: [
      { trigger: "EE", replacement: `\mathbb{E}`, description: "expectation" },
      { trigger: "PP", replacement: `\mathbb{P}` },
    ] },
  ],
}
```

`options`: `t` text · `m` math · `A` auto (otherwise <kbd>Tab</kbd>) · `w` word boundary · `o` wrap the object on the left.
Templates: `$1` `${1:default}` `$0` · `[[0]]` regex groups · `${PREV}` the object on the left.
→ [Full reference](packages/web-laas-engine#config-language)

## Repository

| Package | |
|---|---|
| [`packages/web-laas-engine`](packages/web-laas-engine) | the engine, on npm: config language, matching, math detection, cdlatex movement, editor adapters |
| [`packages/web-laas`](packages/web-laas) | the browser extension: settings, popup, cheat sheet, shortcuts |

```sh
npm install
npm run build       # engine, then extension
npm test            # 150+ unit tests
npm run typecheck
npm run serve:test  # 5 real editors at http://localhost:8765/test/editor/
```

## Credits

The snippet tables and behaviour come from two Emacs packages:
[laas](https://github.com/tecosaur/LaTeX-auto-activating-snippets) by TEC and
[cdlatex](https://github.com/cdominik/cdlatex) by Carsten Dominik — with the Tab integration popularised by
Karthik Chikmagalur's [*LaTeX input for impatient scholars*](https://karthinks.com/software/latex-input-for-impatient-scholars/).

## License

[GPL-3.0-or-later](LICENSE), like laas and cdlatex.
