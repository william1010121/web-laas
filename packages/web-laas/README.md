# web-laas — browser extension

The Chromium extension (Chrome, Arc, Edge, Brave) built on [`web-laas-engine`](../web-laas-engine).
See the [project README](../../README.md) for what it does; this file covers the extension itself.
[繁體中文說明](README.zh-TW.md)

## Build & load

```sh
# from the repository root
npm install
npm run build
```

Open `chrome://extensions` (Arc: `arc://extensions`), enable **Developer mode**, **Load unpacked** → `packages/web-laas/dist/`.
After `npm run build`, press ↻ on the extension card. Open tabs pick up the new build by themselves: every build has
an id, and a newly injected main-world script replaces an older one already running in the page.

## Keys

| | |
|---|---|
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>K</kbd> | in-page cheat sheet (searchable, MathML previews, only this site's snippets) |
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>L</kbd> | turn expansion on / off, with an in-page toast |

Shortcuts are configurable at `chrome://extensions/shortcuts`. Chrome only assigns suggested keys on first install and some
browsers (Arc) don't deliver extension commands, so the content script also listens for the defaults and for whatever
the browser assigned. Pages that can't be scripted (`chrome://`, the Web Store) get a system notification instead.

## Settings

| Page | |
|---|---|
| General | Tab fields, cdlatex Tab movement, script simplification, `$ [ {` pairing, Backspace undo, auto space; the laas / cdlatex / web extras sets; the cheat sheet |
| Snippet editor | your config (like an Emacs init file) with live validation and a playground |
| Cheat sheet | every snippet, searchable, for "any site" or Overleaf |
| Shortcuts | the browser shortcuts and the in-editor keys |
| Sites | sites where expansion is off (also one click in the popup) |

## How it's put together

```
src/content/main.ts       MAIN world: LaasController from web-laas-engine (reaches CodeMirror instances)
src/content/isolated.ts   isolated world: chrome.storage → main.ts via CustomEvent; toasts; shortcut fallback
src/cheatsheet/           cheat sheet (KaTeX → MathML) and the in-page overlay (closed shadow DOM);
                          bundled as cheatsheet.js and injected only when opened, so KaTeX isn't loaded into every frame
src/options/, src/popup/  settings page and popup
src/background.ts         commands, notifications, re-injection into open tabs after an update
```

The build bundles the engine's TypeScript source (the `source` export condition), so engine changes need no separate build.

Permissions: `storage` (settings), `scripting` + `<all_urls>` (inject into tabs that were open before an update),
`notifications` (when a page can't show a toast), `activeTab`.

## Previews

```sh
npm run serve:preview   # http://localhost:8766/test/preview/{options,popup,overlay,isolated}-preview.html
```

They run the built pages with an in-memory `chrome.*` stub. Editor behaviour is tested in the engine package.

## Known limits

- Monaco (Colab, VS Code for the web) isn't supported yet — the engine accepts a custom adapter for it.
- Mirror tabstops (the same number twice) aren't supported; only the first is a field.
- Editors that turn `'` into `’` (smart quotes) break `'` modifiers.
