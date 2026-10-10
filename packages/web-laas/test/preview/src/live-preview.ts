// The live preview on a plain page (no extension APIs), driven by the engine.
// ?mode=above|below|corner&text=...&caret=N presets a formula for screenshots.
import { LaasController } from "web-laas-engine/dom";
import { LivePreview, type PreviewMode } from "../../../src/preview/preview";

const q = new URLSearchParams(location.search);
const preview = new LivePreview(document);
preview.setMode((q.get("mode") as PreviewMode) ?? "above");
const controller = new LaasController({ onFormula: (f) => preview.update(f) });
controller.attach();

const ta = document.getElementById("editor") as HTMLTextAreaElement;
if (q.has("text")) {
  ta.value = q.get("text")!;
  ta.focus();
  const c = Number(q.get("caret") ?? ta.value.length);
  ta.setSelectionRange(c, c);
  controller.refreshFormula();
}
(window as any).preview = preview;
