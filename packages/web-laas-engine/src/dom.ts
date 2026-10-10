// Browser runtime: listens for keystrokes and edits the focused editor
// (textarea, contenteditable / ProseMirror, CodeMirror 5 / 6).
export {
  DEFAULT_PREFS,
  LaasController,
  type ControllerOptions,
  type LaasPrefs,
  type RuntimeState,
} from "./dom/controller";
export {
  adapterFor,
  deepActiveElement,
  CM5Adapter,
  CM6Adapter,
  ContentEditableAdapter,
  TextFieldAdapter,
  type AdapterFactory,
  type EditorAdapter,
} from "./dom/adapters";
