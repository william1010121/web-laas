// Chat sites whose sent messages show as plain text (they typeset only their replies).

/** The element holding the text of a message you sent, per site. */
const SITES: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, '[data-user-message-bubble] .whitespace-pre-wrap, [data-message-author-role="user"] .whitespace-pre-wrap'],
  [/(^|\.)claude\.ai$/, '[data-testid="user-message"]'],
  [/(^|\.)gemini\.google\.com$/, "user-query .query-text"],
];

/** The sent-message selector for `host`, or null on other sites. */
export function messageSelector(host: string): string | null {
  return SITES.find(([re]) => re.test(host))?.[1] ?? null;
}
