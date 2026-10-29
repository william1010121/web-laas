# Privacy policy

*Last updated: 2026-10-11*

This policy covers the LaTeX Anywhere browser extension and the LaTeX Anywhere engine (the `web-laas-engine` npm package).

## What LaTeX Anywhere collects

Nothing. LaTeX Anywhere doesn't collect any user data, store it on a server, or sell it, and it doesn't send data anywhere. The one thing a web page can see is described below, under *What the page itself can see*.

- **Everything runs locally.** The extension reads the text you type in web editors so that it can expand LaTeX snippets and render formulas. That happens entirely inside your browser, and no text, keystrokes or page content is ever sent anywhere.
- **No network requests.** The extension makes no network requests of its own, includes no analytics or tracking, and loads no remote code. MathJax, used to draw formulas, is bundled in the extension.
- **Settings stay in your browser.** Your settings (on/off state, sites you turned it off on, delimiter choices, preview options and your own snippets) are kept in the browser's extension storage (`chrome.storage.local`) on your device. They're removed when you uninstall the extension.
- **What the page itself can see.** Snippets have to be expanded inside the page's editor. So the part of LaTeX Anywhere that runs there receives, through a page event, the settings that page needs: your snippet configuration, your preview options, and the on/off and delimiter settings for that site only. The page's own scripts could read this event too. Settings for other sites (which sites you turned it off on, per-site delimiter choices) are never sent to a page. If your snippet configuration contains anything private, keep in mind that the sites you use LaTeX Anywhere on can see it.

## Permissions

The permissions the extension requests, and why, are listed in the [extension README](packages/web-laas/README.md).

## Contact

Questions about this policy: open an issue at <https://github.com/william1010121/web-laas/issues>.
