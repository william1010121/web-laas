// Formulas rendered in place, in every kind of editor the extension supports.
// ?comments=1 treats % as a LaTeX comment (as on Overleaf).
import "codemirror5/lib/codemirror.css";
import "prosemirror-view/style/prosemirror.css";
import { basicSetup, EditorView as CM6View } from "codemirror";
import CodeMirror from "codemirror5";
import { EditorState } from "prosemirror-state";
import { EditorView as PMView } from "prosemirror-view";
import { DOMParser } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { LaasController } from "web-laas-engine/dom";
import { InlineRender } from "../../../src/preview/inline";
import { LivePreview } from "../../../src/preview/preview";

const LATEX = String.raw`Let $f(x) = \frac{1}{1+e^{-x}}$ and \(y_i \in \mathbb{R}\) for all $i$.
% a comment with $not math$
The integral
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
and an aligned block:
\begin{align*}
a &= b + c \\
  &= d
\end{align*}
Unclosed $x + y and costs $5 and $10.`;

const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);

// ?long=1: a document long enough that CodeMirror leaves far-off lines undrawn
const long = q.has("long") ? Array.from({ length: 60 }, (_, i) => `Section ${i}\n\n${LATEX}\n`).join("\n") : LATEX;
new CM6View({ doc: long, extensions: [basicSetup, CM6View.lineWrapping], parent: $("cm6") });
CodeMirror($("cm5"), { value: long, lineNumbers: true, lineWrapping: true });
($("ta") as HTMLTextAreaElement).value = LATEX;
$("ce").innerHTML = LATEX.split("\n").map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "<br>"}</div>`).join("");
const pmDoc = document.createElement("div");
pmDoc.innerHTML = LATEX.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
new PMView($("pm"), { state: EditorState.create({ doc: DOMParser.fromSchema(schema).parse(pmDoc), plugins: [keymap(baseKeymap)] }) });

const rendered = new InlineRender(document);
rendered.set({ on: q.get("off") === null, comments: q.has("comments") });
const preview = new LivePreview(document);
const controller = new LaasController({ onFormula: (f) => preview.update(f) });
controller.attach();
(window as any).rendered = rendered;
