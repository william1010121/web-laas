# Issue regression evidence

Baseline: `7d33d617974304c03734900db299b58fd90e1960` (0.7.2 main).

Only synthetic text and generated DOM were used. No real chat accounts, messages,
network content, or editor drafts were used. PR #23's opacity changes are not part
of this patch.

## Correctness

- #19: background and isolated-bridge tests reproduce the false/no-reply latch,
  then verify a second composer injection request after settings change without
  reloading the frame. A background injection failure also returns false rather
  than leaving the bridge permanently latched.
- #15: tests cover `content-visibility: auto` and `hidden` on both `html` and
  `body`, plus the existing viewport-overflow propagation cases.
- #21: regression tests check one marked/contained mirror across fields, one
  contenteditable linearization per operation, synchronous mutation invalidation,
  incremental shadow discovery, late attached roots, listener/timer teardown,
  disabled-site gating, no ordinary-page CM5 polling, delayed CM5 initialization,
  visible-message priority, bounded batches and cancellation.

The new #19/#15 tests failed on baseline (four failures). The adapter and
batching/polling regression tests also failed against baseline source (three
adapter failures and two extension failures). The new indexed-shadow helper is
additionally covered directly; before/after whole-bridge work is measured below.

Validation: `npm run build`, `npm test` (217 engine + 64 extension tests),
`npm run typecheck`, `npm run site`, and
`npm run test:types -w web-laas-engine` pass. Lifecycle checks also cover cleanup of discovery timers/listeners and
disabled-site gating.

## Reproduce

Create a separate checkout of the baseline commit and install the same locked
Node dependencies in both checkouts. From the changed checkout:

```sh
node scripts/benchmark-issues.mjs /path/to/baseline > evidence/issue-21-jsdom-benchmark.json
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/browser-issues.mjs /path/to/baseline
```

The optional browser harness requires Playwright and Chromium. `CHROMIUM_PATH`
overrides `/usr/bin/chromium`. It creates synthetic `about:blank` documents and
injects bundled fixture code; it does not navigate to local files or live sites.
For the composer fixture only, the bundle uses a synthetic hostname and in-memory
Chrome API stand-ins to exercise background/bridge integration.

`issue-browser-results.json` contains all three alternating before/after browser
runs, not selected best cases. `issue-21-jsdom-benchmark.json` is supplementary
same-process DOM-work evidence, not a substitute for real browser layout.

## Browser results

Chromium 154.0.8037.57, three alternating runs on the same host. Medians:

| Synthetic workload | Baseline | Changed |
| --- | ---: | ---: |
| 100 textarea caret measurements | 114.0 ms | 118.1 ms |
| 25 selection/text operations, 2,000 paragraphs | 988.1 ms | 188.3 ms |
| 25 math checks, 10,004 DOM elements | 74.8 ms | 25.1 ms |
| Longest message-render timer task, 80 messages | 114.5 ms | 21.0 ms |
| All 80 messages complete, including initial delay | 282.0 ms | 343.9 ms |

Deterministic work counts: textarea body insertions 101 → 1 (including the
initial geometry check), contenteditable traversals 125 → 25, shadow-discovery
node visits 250,100 → 10,004, and CM5 document queries over 15 simulated idle
seconds 10 → 0. All caret geometry checks agree.

The standards-mode clipping fixture leaves one formula overlay outside the
30-pixel body on baseline and zero after the fix, for each of the four
html/body + auto/hidden cases. The composer fixture stays at zero injections
after re-enabling on baseline and reaches exactly one after the fix.

## Interpretation and limits

- Mirror DOM insertion drops from once per measurement to once per document.
  Browser caret coordinates are checked for equality. Paired browser runs are
  99.1 → 118.1, 114.0 → 116.4, and 114.4 → 132.3 ms per 100 measurements:
  roughly 0.02–0.19 ms slower per call. The supported gain is reduced allocation
  and page-observer churn, not caret latency; this patch does not claim parity
  or a caret latency win.
- Contenteditable traversals drop from five to one in the measured selection /
  text / selection operation. Synchronous framework changes invalidate the cache.
- Foreground math checks no longer rewalk all elements for shadow roots. Added
  subtrees and focus/input paths update the index. A cooperative refresh also
  discovers roots attached later to existing, unfocused hosts: each round begins
  ten seconds after the prior one finishes, with slices of at most 500 nodes or
  four milliseconds. This trades a possible background discovery delay for
  keeping long document walks out of focus/scroll/typing tasks.
- CM5 pages retain candidate-only polling for late initialization and mode
  changes. Pages without wrappers have no CM5 interval or recurring global query.
- Message rendering yields after four messages or eight milliseconds, but a
  single message is atomic, so an unusually expensive individual message can
  exceed that budget. The benchmark reports both peak synchronous task time and
  total completion time: yielding can make total completion slower while keeping
  the page responsive. No hard wall-clock performance assertion is used.
- Synthetic results are not a claim of exhaustive live-site compatibility.
