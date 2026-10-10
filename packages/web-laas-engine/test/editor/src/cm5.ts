import CodeMirror from "codemirror5";

// Like HackMD / classic Jupyter Notebook.
const cm = CodeMirror(document.getElementById("editor")!, {
  value: "HackMD-like CodeMirror 5 editor.\n",
  lineNumbers: true,
  lineWrapping: true,
});
(window as any).editorText = () => cm.getValue();
(window as any).editorCaret = () => cm.indexFromPos(cm.getCursor());
