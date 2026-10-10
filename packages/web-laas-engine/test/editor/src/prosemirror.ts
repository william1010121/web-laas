import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { DOMParser } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";

// Like ChatGPT / Claude.ai composers (ProseMirror / TipTap), without smart quotes.
const content = document.createElement("div");
content.innerHTML = "<p>ProseMirror editor (ChatGPT / Claude style).</p>";
const view = new EditorView(document.getElementById("editor")!, {
  state: EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(content),
    plugins: [history(), keymap({ "Mod-z": undo, "Mod-Shift-z": redo }), keymap(baseKeymap)],
  }),
});
(window as any).editorText = () => view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
