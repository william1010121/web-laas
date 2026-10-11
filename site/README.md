# Showcase site

The page at <https://william1010121.github.io/web-laas/>: what web-laas does, with live demos.

- `index.html`, `site.css`: the page.
- `src/site.ts`: replays the recorded scenes, and runs the real engine, live preview, in-place rendering and cheat sheet from `packages/`.
- `tools/simulate.ts`: types each scene into a textarea driven by the real engine (in jsdom) and records every state into `scenes.json`, so the animations show exactly what the extension does. Edit `SCENES` there to change a demo.
- `tools/build.mjs`: records the scenes and bundles everything into `dist/`.
- `img/`: screenshots of the extension at work in ChatGPT, and of its popup.

```sh
npm run site                              # build into site/dist
python3 -m http.server -d site/dist 8770  # then open http://localhost:8770
```

`.github/workflows/pages.yml` builds and deploys it to GitHub Pages on every push to `main`.
