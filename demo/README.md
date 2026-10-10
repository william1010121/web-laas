# Demo video

The README's demo, made with [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML → MP4).

Nothing in the editor is hand-animated: `scripts/simulate.ts` types the script into a textarea driven by the
real `web-laas-engine` (on jsdom) and records every state; `scripts/render-math.mjs` renders each formula with
KaTeX; `scripts/build-html.mjs` inlines them into `index.html`, whose timeline only displays those states.

```sh
cd demo
npm run states    # simulate with the engine → assets/states.json → index.html
npm run check     # HyperFrames lint / layout / contrast
npm run render    # → renders/*.mp4
```

Edit the typed script in `scripts/simulate.ts` (`SCRIPT`) and the look in `scripts/index.template.html`.
