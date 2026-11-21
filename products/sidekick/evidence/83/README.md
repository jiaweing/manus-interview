# Issue #83 — stale-action rejection

Scope: dispatcher grounding and validation only (PRD P0-F2, P0-F3, P0-F5). No panel UI, tool implementations, safety policy, execution loop, or hosting-gate changes.

## Implementation / follow-up integration

`apps/extension/src/action-dispatcher.ts` exports `createActionDispatcher(api)`. The visible panel binds a locally generated `runId` to the selected `tabId` and fresh snapshot/document IDs with `bindRun(binding)`, then submits shared-protocol `Action` envelopes through `dispatch(action)`. Both operations inject only `content-scripts/content.js` with `world: "ISOLATED"` and top-frame targeting, then send same-extension runtime messages. The model cannot supply the injected file or executable code.

The content listener owns one `createPageDispatcher(document, observer, executor?)` per document. It validates the shared Zod action schema, active-run/tab identity, current snapshot registry, document/root/URL, recorded element reference, observed rendered semantics, local attributes/resolved form destinations, and recorded parent/neighbors immediately before the synchronous executor call. Removed or identical replacement nodes cannot be selected through an old index. Reordering conservatively requires a new snapshot. There is no fallback selector or re-enumeration of candidate controls. Action IDs are consumed before an executor call, so exceptions cannot replay an uncertain mutation.

Snapshot capture and dispatcher identity now share `renderedSemantics(element)` in `snapshot.ts`: role, accessible name, enabled state, visibility, resolved href, input type, and normalized visible text are computed by the same code. Snapshot descriptor fields and the wire payload remain unchanged; the visible-text/visibility identity stays local. The raw `textContent` and raw external-label fingerprints are no longer used as a substitute for rendered semantics. Document/base URI, own attributes, tag/namespace, form destinations, and structural checks retain their existing conservative guards. No geometric coordinates enter the semantic comparison.

Stale results are `{status: "stale-target", reason, reobserveRequired: true}`; malformed envelopes are `{status: "invalid-action", reason: "malformed-envelope", reobserveRequired: true}`. The future loop must recover with fresh observation, not replay the old action. `dispatched` means the trusted executor was called, **not** that task success was established. Exceptions and transport failures are `unverified` and are not automatically retried.

Tool builders (#84–#87) supply packaged implementations through the optional `PageActionExecutor` argument to `installSnapshotObserver`. No real tool is enabled by this issue alone: production returns `unsupported-tool` after successful preflight when no executor is installed. The browser proof uses a disposable test-only trusted executor that clicks local dummy buttons; that executor is never placed in production output or the production manifest. Capture bounds/redaction remain owned by #81/#82.

## Verifier-confirmed CSS-label defect

The independent finding is documented in [issue comment 7064783143](https://github.com/jiaweing/manus-interview/issues/83#issuecomment-7064783143). The recorded button contains two spans: initially `First` is visible and `Delete all data` is hidden. Changing only the stylesheet swaps their visibility without changing the button's raw DOM, own attributes, parent, or neighbors. The old dispatcher incorrectly clicked once.

Four new unit regressions cover CSS-only descendant labels, native labels, ARIA-referenced label content, and visible text changing beneath an unchanged explicit accessible name. Against the old dispatcher the focused suite produced **45 pass / 4 fail, exit 1**. With the shared semantic fingerprint it produces **49 pass / 0 fail**, preserving all 45 existing tests. Each new stale case asserts zero mutations and that preflight does not call `observe` to refresh the registry.

## Verification

Commands were run from `products/sidekick` with Bun 1.4.5 on 2026-11-21 after `git fetch origin && git rebase origin/main` (exit 0), rebasing the existing branch onto `9de89de098832afc2fba08c9712e52f94e3b50d1`. The production extension was rebuilt before the generated-manifest test. `https://example.com` is only the explicit build configuration; no live proxy/hosting assertion is implied.

| Command | Exit | Result / saved output |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | `install.log`; no environment required |
| `bun run fix` | 0 | `fix.log`; scoped code formatting |
| `WXT_SIDEKICK_PROXY_URL=https://example.com bun run build:extension` | 0 | `build-extension.log`; production MV3 output |
| `bun test apps/extension/src/page/dispatch.test.ts` | 0 | **49 pass, 0 fail, 189 assertions**; `dispatch-test.log` |
| `bun run typecheck` | 0 | server + extension; `typecheck.log` |
| `bun run check` | 0 | Biome/Ultracite; `check.log` |
| `WXT_SIDEKICK_PROXY_URL=https://example.com bun test` | 0 | **214 pass, 0 fail, 940 assertions**, 7 files; `full-suite.log` |
| `xvfb-run -a bun evidence/83/browser-check.ts` | 0 | headed `/usr/bin/chromium`; `browser-check.log`, `browser-results.json`, `matching-once.png` |
| `xvfb-run -a bun evidence/83/css-label-check.ts` | 0 | portable adaptation of verifier repro; `css-label-check.log`, `css-label-results.json`, `css-label-change.png` |
| `bun run verify:secrets` (unique dummy scan token supplied privately, no provider key) | 0 | `secrets.log`; no sensitive values printed |
| `git diff --check` / `git diff --cached --check` | 0 | evidence trailing whitespace stripped |

The full count includes the panel-shell tests now on main. The exact issue verification command passes. Stale/malformed test cases assert mutation count **0**; the matching-target case asserts **1**, with duplicate replay still at **1**. Boundary tests assert the fixed packaged isolated script descriptor and frame-0 message, never a model-supplied function.

## Real Chromium proof

`browser-check.ts` is a reproducible manual evidence harness, not part of `bun test`. It copies production output into disposable fresh profiles and grants only its local dummy fixture origin in that copy. First it verifies the actual production packaged listener is isolated from the page world and rejects a removed target with zero mutations. Then it bundles the same dispatcher/observer modules with the test-only trusted click executor in the disposable copy. Removed, replaced, reordered, hidden, disabled, superseded-snapshot, malformed, unknown-index, and navigated-document actions all mutate **0** and explicitly require observation. A matching target mutates **1**, and its duplicate is rejected.

The harness now also includes the verifier's CSS-only `First` → `Delete all data` reproduction and explicitly asserts unchanged target `outerHTML`. The standalone `css-label-check.ts` repeats the original verifier reproduction with worktree-relative imports and fresh browser profiles. Both return `{status: "stale-target", reason: "target-changed", reobserveRequired: true}` with mutation count **0**. `css-label-change.png` shows the changed button label and local counter `0`. No provider calls occur. Browser profiles and modified extension copies are removed afterward.

## Unverified / limitations

- Real OpenRouter API checks: **not run: no key**. Automated tests use fake adapters; this issue makes no provider calls.
- `bun run test:https`: **not run**. The separate live HTTPS hosting gate is owned by #78 and requires a real hosting URL/token. It is deliberately excluded from `bun test` and was not modified or bypassed.
- Actual user click/fill/read/scroll/tab execution and policy are deferred to #84–#87. The execution loop, Stop/panel closure, and confirmation integration remain with their own issues.
- No PRD ambiguity required additional functionality: conservative stale rejection is used rather than guessing.
