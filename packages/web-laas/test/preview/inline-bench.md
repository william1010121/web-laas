# Rendering formulas in place: performance

`inline-bench.html` measures `InlineRender` (the overlay that shows formulas
rendered over their source) on long documents.

```
npm run serve:preview -w web-laas        # serves packages/web-laas on :8766
open http://localhost:8766/test/preview/inline-bench.html?editor=pm&n=2000
bench()                                   # in the console; resolves to the numbers
```

`editor` is `cm6` (CodeMirror 6: Overleaf, Jupyter), `cm5` (HackMD), `pm`
(ProseMirror: ChatGPT, Claude), `ce` (contenteditable) or `ta` (textarea); `n`
is the number of paragraphs, `steps` the number of scroll jumps (default 80).

## What it does

The document has `n` paragraphs, each with two distinct inline formulas, and a
display formula after every tenth: `n = 2000` is 240k characters and 4,200
formulas, `n = 10000` is 1.2M characters and 21,000 formulas. There are no
blank lines, so nothing can be skipped by paragraph. The editor is 900×600 px.

The renderer runs as in the extension (`set({ on: true })`: mutation observer,
scroll and selection listeners, one update per animation frame). Every update
is timed; the editor's own layout after a change is forced first and timed
apart, since that is the browser's work, not ours.

| column | what |
|---|---|
| cold | the first update: read the text, find the formulas, draw the first screen |
| idle | an update with nothing changed (what the 700 ms safety timer costs) |
| scroll jump | the frame after jumping to a new place (scroll bar drag): a screen of formulas never drawn before |
| wheel | the frame after a 40 px scroll (wheel / trackpad) |
| typing | the two frames after inserting a character mid-document |
| boxes | overlay boxes in the DOM afterwards |

Times are milliseconds, `mean / p95`. Measured in Chromium 154 on an Apple
Silicon Mac.

## Results

### 240k characters, 4,200 formulas

Before is the first version of the feature (680fd1b), with the same harness and
8 instead of 80 scroll jumps (it is too slow for more).

| editor | | cold | idle | scroll jump | wheel | typing | boxes |
|---|---|---:|---:|---:|---:|---:|---:|
| ProseMirror | before | 4,410 | 113 / 145 | 265 / 329 | 323 / 375 | 6,715 / 7,374 | 4,200 |
| | **after** | **14** | **0.5 / 0.9** | **13.8 / 21.9** | **4.6 / 6.0** | **10.9 / 15.1** | 56 |
| contenteditable | before | 4,494 | 143 / 224 | 291 / 405 | 325 / 350 | 8,810 / 9,685 | 4,200 |
| | **after** | **18** | **0.6 / 0.7** | **10.9 / 19.0** | **4.9 / 6.1** | **10.7 / 20.3** | 61 |
| textarea | before | 5,141 | 230 / 474 | 416 / 604 | 452 / 459 | 7,195 / 7,507 | 4,200 |
| | **after** | **22** | **0.3 / 0.4** | **10.9 / 22.1** | **3.4 / 4.4** | **8.6 / 22.2** | 40 |
| CodeMirror 6 | before¹ | 11 | 0.7 / 1.5 | 0.5 / 1.0 | 2.0 / 2.3 | 1.4 / 1.7 | 2 |
| | **after** | **7** | **0.3 / 0.8** | **6.9 / 9.7** | **2.9 / 5.1** | **1.8 / 2.2** | 36 |
| CodeMirror 5 | before¹ | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0 |
| | **after** | **7** | **1.0 / 6.3** | **7.1 / 9.9** | **2.1 / 4.7** | **1.5 / 2.4** | 16 |

¹ Fast because it was broken: past CodeMirror's first undrawn stretch it found
no formulas (2 drawn in CM6, none in CM5).

### 1.2M characters, 21,000 formulas (after only)

| editor | cold | idle | scroll jump | wheel | typing | browser's own layout per keystroke |
|---|---:|---:|---:|---:|---:|---:|
| CodeMirror 6 | 6.5 | 0.2 / 0.5 | 6.5 / 8.8 | 3.4 / 5.6 | 1.8 / 2.5 | 0.0 |
| CodeMirror 5 | 7.6 | 0.4 / 1.2 | 7.9 / 11.1 | 2.7 / 5.8 | 2.3 / 3.3 | 0.0 |
| ProseMirror | 24.5 | 0.6 / 1.3 | 12.8 / 26.8 | 5.5 / 9.7 | 25.3 / 32.6 | 9.7 / 13.8 |
| contenteditable | 27.6 | 0.7 / 3.1 | 13.0 / 28.4 | 5.5 / 10.1 | 28.0 / 39.9 | 9.9 / 14.7 |
| textarea | 64 | 0.4 / 0.4 | 9.4 / 20.0 | 4.1 / 7.2 | 25.4 / 52.3 | 50.9 / 108.7 |

Scrolling costs the same at 1.2M characters as at 240k: only the formulas near
the window are touched. Typing grows with the document in the rich editors and
the textarea, because their text is read again after each change (CodeMirror
only has the lines near the window in the page); a read that takes longer than
12 ms happens at most every 200 ms while typing goes on. For scale, the
textarea's own layout after a keystroke at this size is about 50 ms.

### With SVG rendering (MathJax), 240k characters

The tables above were measured when formulas were drawn as MathML by the
browser (KaTeX's MathML output). They are now SVG from MathJax, which looks
like LaTeX in any browser (Chrome's own MathML misdraws radicals and accents)
at a cost: about 0.55 ms per new formula instead of under 0.1 ms. A frame
renders new formulas for at most 8 ms and leaves the rest to the next ones
(formulas come in over a few frames after a jump), and formulas just off
screen are rendered ahead while the page is idle. Box styles are written only
when they change. Here each column is the longest frame after the action.

| editor | cold | scroll jump | wheel | typing | boxes |
|---|---:|---:|---:|---:|---:|
| CodeMirror 6 | 13 | 19.9 / 35.8 | 7.6 / 19.3 | 0.0 / 0.8 | 36 |
| CodeMirror 5 | 29 | 14.0 / 18.2 | 7.2 / 24.8 | 0.0 / 0.0 | 35 |
| ProseMirror | 18 | 23.5 / 43.8 | 12.9 / 21.6 | 7.1 / 30.3 | 56 |
| contenteditable | 25 | 27.9 / 62.5 | 19.4 / 39.6 | 4.0 / 23.7 | 61 |
| textarea | 45 | 27.8 / 54.4 | 14.8 / 48.2 | 9.4 / 23.4 | 40 |

The benchmark scrolls every other frame, leaving little idle time to render
ahead; ordinary scrolling finds more formulas ready.

### Finding the formulas (`findFormulas`, Node)

| text | before | after |
|---|---:|---:|
| 230k characters, LaTeX rules | 279 ms | 5.7 ms |
| 230k characters, Markdown rules | 31 ms | 9.1 ms |
| 1.2M characters, LaTeX rules | 6,679 ms | 27 ms |
| 1.2M characters, Markdown rules | 248 ms | 39 ms |

Before, each formula copied the rest of the text and searched it for the next
blank line, which made a document without blank lines quadratic.

## Where the time went, and what changed

- **Everything, every frame.** Each update read the whole editor, found every
  formula and drew all of them (4,200 boxes of MathML). Now an editor's text
  is read only when a mutation inside it says it changed, and only formulas
  within 120 px of the visible area are drawn, found by bisection since they
  run top to bottom.
- **Typing rebuilt boxes.** Boxes were keyed by text offset, so a keystroke
  re-created every box after it. They are now reused by their MathML.
- **One layout per new box.** New boxes are measured (to shrink formulas wider
  than their source) together, in one layout pass.
- **Quadratic scans.** `findFormulas` copied the rest of the text per formula
  and searched it for a blank line; it now scans in place and remembers the
  next blank line. Reading a rich editor's text asked the string being built
  for its last character at every block, which makes V8 flatten it each time
  (37 ms → 1.5 ms for 240k characters).
- **Text fields.** The hidden copy used to measure positions was rebuilt from
  scratch on every keystroke; it is kept in 32-line pieces and an edit replaces
  only the pieces it touches.
- **CodeMirror's undrawn lines.** CodeMirror keeps far-off lines out of the
  page. Text right after such a stretch may start inside a formula; the
  main-world script (which can reach the editor) reports how each undrawn
  paragraph starts, so formulas there are found even without blank lines.
