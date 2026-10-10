// web-laas-engine: LaTeX auto-activating snippets (Emacs laas style) for the web.
// This entry is pure logic (no DOM); see "web-laas-engine/dom" for the editor runtime.
export { parseConfigText, ParseError } from "./core/parser";
export {
  compileConfig,
  hostMatches,
  snippetsForHost,
  withMathDelimiters,
  resolveMathDelimiters,
  type CompiledConfig,
  type MathDelimiters,
  type InlineMathStyle,
  type DisplayMathStyle,
  type CompileOptions,
  type SnippetSource,
  type ConfigIssue,
  type Snippet,
} from "./core/config";
export { findExpansion, type Expansion, type MatchOptions } from "./core/matcher";
export { mathContext, objectStart, unwrapObject, type MathContext } from "./core/tex";
export { formulaAt, type Formula } from "./core/formula";
export { cdlatexModify, cdlatexTab, type ModifyResult, type ModifySpec, type TabMove } from "./core/cdlatex";
export {
  cheatsheetEntries,
  groupCheatsheet,
  previewLatex,
  type CheatsheetEntry,
  type CheatsheetGroup,
} from "./core/cheatsheet";
export {
  renderTemplate,
  tokenizeTemplate,
  type Range,
  type Rendered,
  type TemplateToken,
} from "./core/template";
export { CDLATEX_CONFIG_TEXT, DEFAULT_CONFIG_TEXT, EXTRAS_CONFIG_TEXT } from "./core/defaults";
