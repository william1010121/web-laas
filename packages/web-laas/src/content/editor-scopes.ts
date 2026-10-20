/** Discover open shadow roots once, then only walk newly inserted subtrees.
 * Focus/input paths also reveal roots attached later to an existing host. */
export class EditorScopes {
  private readonly roots = new Map<Document | ShadowRoot, MutationObserver>();
  private readonly cleanups = new Map<ShadowRoot, () => void>();
  private refreshTimer = 0;
  private stopped = false;

  constructor(private readonly doc: Document, private readonly onShadow: (root: ShadowRoot) => void | (() => void), private readonly active = () => true) {
    this.add(doc);
    this.refreshTimer = window.setTimeout(() => this.refresh(), 10000);
  }

  private add(root: Document | ShadowRoot) {
    if (this.stopped || this.roots.has(root)) return;
    const observer = new MutationObserver((records) => this.changed(records));
    this.roots.set(root, observer);
    observer.observe(root, { childList: true, subtree: true });
    if (root instanceof ShadowRoot) {
      const cleanup = this.onShadow(root);
      if (cleanup) this.cleanups.set(root, cleanup);
    }
    this.discover(root);
  }

  private discover(node: Node) {
    if (node instanceof Element && node.shadowRoot) this.add(node.shadowRoot);
    if (node instanceof Element || node instanceof Document || node instanceof ShadowRoot) {
      for (const el of node.querySelectorAll("*")) if (el.shadowRoot) this.add(el.shadowRoot);
    }
  }

  private changed(records: MutationRecord[]) {
    for (const record of records) for (const node of record.addedNodes) this.discover(node);
  }

  see(event: Event) {
    for (const node of event.composedPath()) {
      if (node instanceof ShadowRoot) this.add(node);
      else if (node instanceof Element && node.shadowRoot) this.add(node.shadowRoot);
    }
  }

  all(): (Document | ShadowRoot)[] {
    for (const [root, observer] of this.roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect();
        this.roots.delete(root);
        this.cleanups.get(root)?.();
        this.cleanups.delete(root);
      } else this.changed(observer.takeRecords());
    }
    return [...this.roots.keys()];
  }

  // attachShadow() on an existing host does not emit a document mutation.
  // Revisit hosts cooperatively, independently of focus/scroll/math checks, so
  // late, unfocused editors still appear without a whole-page synchronous walk.
  private refresh() {
    if (!this.active()) return this.destroy();
    if (this.stopped) return;
    const scopes = this.all();
    let index = 0;
    let walker = this.doc.createTreeWalker(scopes[index], NodeFilter.SHOW_ELEMENT);
    const step = () => {
      if (!this.active()) return this.destroy();
      if (this.stopped) return;
      const start = performance.now();
      let visited = 0;
      while (index < scopes.length && visited < 500 && performance.now() - start < 4) {
        const node = walker.nextNode() as Element | null;
        if (node) { if (node.shadowRoot) this.add(node.shadowRoot); visited++; }
        else if (++index < scopes.length) walker = this.doc.createTreeWalker(scopes[index], NodeFilter.SHOW_ELEMENT);
      }
      this.refreshTimer = window.setTimeout(index < scopes.length ? step : () => this.refresh(), index < scopes.length ? 16 : 10000);
    };
    step();
  }

  destroy() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    for (const observer of this.roots.values()) observer.disconnect();
    this.roots.clear();
    for (const cleanup of this.cleanups.values()) cleanup();
    this.cleanups.clear();
  }
}
