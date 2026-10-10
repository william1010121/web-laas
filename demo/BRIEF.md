---
workflow: general-video
flow: automation
storyboard: no
message: "Type ;a and get \\alpha — Emacs-grade LaTeX snippets in every web editor"
destination: github-readme
aspect: 1920x1080
language: en
length: 45s
angle: product-demo
---

## Intent

A demo of web-laas (the browser extension + web-laas-engine) for the GitHub README and npm page:
one formula is typed live in a web editor, and every snippet expands as it would for the user.
The audience is people who write math in Overleaf / ChatGPT / Notion — many of them Emacs laas/cdlatex users.

## Customizations

- Key display: the keys being pressed are shown on screen the whole time (a persistent key bar), so the
  viewer can see exactly what was typed — especially for the short triggers like `;a`.
- The last expansion stays visible (e.g. `;a → \alpha`) until the next one happens.

## Notes

- Every editor state must be produced by the real engine (no faked expansions).
- Brand: teal accent on a dark, slightly teal-tinted canvas — the extension's own colours.
- No narration or music was requested.
