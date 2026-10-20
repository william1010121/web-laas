import { build } from "esbuild";
import { readFile } from "node:fs/promises";
export async function bundle(root) {
  const result = await build({
    stdin: { contents: `export { TextFieldAdapter } from './packages/web-laas-engine/src/dom/adapters/textarea';
      export { ContentEditableAdapter } from './packages/web-laas-engine/src/dom/adapters/contenteditable';
      export { CM5Math } from './packages/web-laas/src/content/cm5-math';
      export { MessageRender } from './packages/web-laas/src/preview/messages';
      export { clippersOf, InlineRender } from './packages/web-laas/src/preview/inline';
      export { editorsHaveMath } from './packages/web-laas/src/content/isolated';`, resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: 'bench', conditions: ['source'], loader: { '.laas': 'text' },
    plugins: [{ name: 'expose-probe', setup(b) { b.onLoad({ filter: /content\/isolated\.ts$/ }, async ({ path }) => ({ contents: await readFile(path, 'utf8') + '\nexport { editorsHaveMath };', loader: 'ts' })); } }],
  });
  return result.outputFiles[0].text;
}

export async function bundleExtension(root, entry) {
  const result = await build({ entryPoints: [`${root}/packages/web-laas/src/${entry}.ts`], bundle: true, write: false,
    format: 'iife', conditions: ['source'], loader: { '.laas': 'text' },
    // The fixture stays on about:blank; supply a synthetic host to the bridge.
    define: { 'location.hostname': '"chatgpt.com"' },
  });
  return result.outputFiles[0].text;
}
