# LaTeX Anywhere

Emacs laas / cdlatex LaTeX snippets for web editors.

- `packages/web-laas-engine`: the engine, published on npm.
- `packages/web-laas`: the Chromium extension (MV3).
- `site/`: the showcase page.
- `demo/`: the README video.

Everything in the repo is in English.

Checks: `npm run build && npm test && npm run typecheck`, and `npm run site` for the page.

## Review guidelines

Only comment on problems that matter to people using LaTeX Anywhere or the engine. A clean review with no comments is a good outcome. Don't go looking for something to say.

**Do flag:**

- Bugs a user would plausibly hit on real sites:
  - Overleaf, ChatGPT, Claude, Notion, HackMD, JupyterLab
  - ordinary textareas and contenteditable editors
  - wrong text inserted, lost keystrokes, a broken caret or undo, crashes or exceptions
  - formulas rendered wrong or over the wrong text
- Data loss, or corrupting what the user typed.
- Security and privacy problems:
  - sending page content or settings anywhere they shouldn't go
  - script injection
  - permissions the extension doesn't need
- Noticeable performance regressions on long documents: typing, scrolling, memory that grows without bound.
- Breaking changes to the engine's public API or its published types.
- Anything that would get the extension rejected by the Chrome Web Store.

**Don't flag:**

- Theoretical spec corner cases that no real page is likely to produce. Examples: exotic combinations of CSS containment, overflow propagation, transforms, writing modes or custom properties on the editor or its ancestors.
- Follow-ups to a fix that only matter in an even rarer setup than the one just fixed.
- Style, naming, comment wording or formatting.
- Refactors and "could be cleaner" suggestions.
- Missing tests, unless a real bug is left untested.
- Behaviour that is a documented, deliberate trade-off. Examples: the README, `PRIVACY.md`, a code comment or the PR description saying why it is so.

**Severity and wording:**

- Rate it P1 when users will hit it. Rate it P2 only for a real but uncommon problem on a real site or editor.
- If you are unsure whether something matters in practice, leave it out.
- Name the concrete site or editor setup where it goes wrong.
