/** A linear-text view of an editor. Offsets are UTF-16 code units. */
export interface EditorAdapter {
  readonly kind: string;
  /** stable identity of the editor (for tabstop sessions) */
  readonly id: object;
  getSelection(): { from: number; to: number } | null;
  getLength(): number;
  /** text in [max(0, pos - max), pos) */
  textBefore(pos: number, max: number): string;
  slice(from: number, to: number): string;
  /** replace [from, to) with text, then select [selFrom, selTo] */
  replace(from: number, to: number, text: string, selFrom: number, selTo: number): void;
  setSelection(from: number, to: number): void;
  /** true while the editor's own autocomplete popup is open (Tab is left to it) */
  completionActive?(): boolean;
}
