import { basicSetup, EditorView } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

// Like Overleaf / JupyterLab: basicSetup (closeBrackets, autocompletion, history) + Tab indents.
const view = new EditorView({
  doc: "Overleaf-like CodeMirror 6 editor.\n",
  extensions: [basicSetup, keymap.of([indentWithTab]), EditorView.lineWrapping],
  parent: document.getElementById("editor")!,
});
(window as any).editorText = () => view.state.doc.toString();
(window as any).editorCaret = () => view.state.selection.main.head;
