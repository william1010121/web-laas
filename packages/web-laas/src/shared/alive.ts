/** False once the extension was reloaded/removed and this content script is orphaned. */
export function alive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
