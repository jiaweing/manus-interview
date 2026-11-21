# Issue #83 — stale-action rejection

Scope: dispatcher grounding and validation only (PRD P0-F2, P0-F3, P0-F5). No panel UI, tool implementations, safety policy, execution loop, or hosting-gate changes.

## Implementation / follow-up integration

`apps/extension/src/action-dispatcher.ts` exports `createActionDispatcher(api)`. The visible panel binds a locally generated `runId` to the selected `tabId` and fresh snapshot/document IDs with `bindRun(binding)`, then submits shared-protocol `Action` envelopes through `dispatch(action)`. The model cannot supply the injected file or executable code. Both operations inject only `content-scripts/content.js` with `world: "ISOLATED"` and top-frame targeting, then send same-extension runtime messages.

The installed content listener owns one `createPageDispatcher(document, observer, executor?)` per document. It validates the shared Zod action schema, active-run/tab identity, current snapshot registry, document/root/URL, recorded element reference, visibility/enabled state, local identity (attributes, text/labels, resolved link/form destinations), and recorded parent/neighbors immediately before the synchronous executor call. Removed or identical replacement nodes cannot be selected through an old index. Reordering conservatively requires a new snapshot. There is no fallback selector or re-enumeration of candidate controls. Action IDs are consumed before an executor call, so exceptions cannot replay an uncertain mutation.

Stale results are `{status: "stale-target", reason, reobserveRequired: true}`; malformed envelopes are `{status: "invalid-action", reason: "malformed-envelope", reobserveRequired: true}`. The future loop must handle this flag with fresh observation, not replay the old action. `dispatched` means the trusted executor was called, **not** that task success was established. Exceptions and transport failures are `unverified` and are not automatically retried.

Tool builders (#84–#87) supply packaged implementations through the optional `PageActionExecutor` argument to `installSnapshotObserver`. No real tool is enabled by this issue alone: the production dispatcher returns `unsupported-tool` after successful preflight when no executor is installed. This avoids implementing #85's click/fill or bypassing #87's policy. The browser proof explicitly uses a disposable test-only trusted executor that clicks local dummy buttons; that executor is never placed in the production output or manifest.

The only change to snapshot capture is a read-only `matchesSnapshot(snapshotId, documentToken)` registry check; capture/bounds/redaction remain owned by #81/#82.

## Final verification

Commands were run from `products/sidekick` with Bun 1.4.5 on 2026-11-21. The extension was rebuilt before testing the generated manifest. The production build and full suite use the same explicit non-routable HTTPS proxy URL; no real hosting assertion is implied.

| Command | Exit | Result / saved output |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | `install.log`; no environment required |
| `bun run fix` | 0 | `fix.log` |
| `WXT_SIDEKICK_PROXY_URL=https://sidekick-proxy.example.invalid bun run build:extension` | 0 | `build-extension.log` |
| `bun test apps/extension/src/page/dispatch.test.ts` | 0 | **45 pass, 0 fail, 153 assertions**; `dispatch-test.log` |
| `bun run typecheck` | 0 | server + extension; `typecheck.log` |
| `bun run check` | 0 | Biome/Ultracite; `check.log` |
| `WXT_SIDEKICK_PROXY_URL=https://sidekick-proxy.example.invalid bun test` | 0 | **188 pass, 0 fail, 756 assertions**, 6 files; `full-suite.log` |
| `xvfb-run -a bun evidence/83/browser-check.ts` | 0 | headed `/usr/bin/chromium`; `browser-check.log`, `browser-results.json`, `matching-once.png` |
| `bun run verify:secrets` (unique dummy scan token supplied via environment, no provider key) | 0 | `secrets.log`; no sensitive values printed |

The exact issue verification command passes. Stale/malformed test cases assert mutation count **0**; the matching-target case asserts **1**, with duplicate replay still at **1**. Boundary tests assert the fixed packaged isolated script descriptor and frame-0 message, never a model-supplied function.

## Real Chromium proof

`browser-check.ts` is a reproducible manual evidence harness (not part of `bun test`). It copies the production extension into a disposable profile and grants only its local dummy fixture origin in that copy. It first verifies that the actual production packaged listener is isolated from the page world and rejects a removed target with zero mutations. It then bundles the same dispatcher/observer modules with a fixture-only trusted click executor in the disposable copy, and confirms removed, replaced, reordered, hidden, disabled, superseded-snapshot, malformed, unknown-index, and navigated-document actions all mutate **0** times and explicitly require observation. A matching target mutates **1** time, and its duplicate is rejected. All browser profiles and modified extension copies are removed afterward.

## Unverified / limitations

- Real OpenRouter API checks: **not run: no key**. The automated suite uses fake adapters; this issue makes no provider calls.
- `bun run test:https`: **not run**. The separate live HTTPS hosting gate is owned by #78 and needs the hosting URL/token; this PR does not change it.
- Actual user click/fill/read/scroll/tab execution and policy are deliberately deferred to #84–#87. The execution loop, Stop/panel closure, and confirmation integration remain with their own issues.
- No PRD ambiguity was used to add functionality: conservative stale rejection is chosen instead of guessing when surrounding control order or observed semantics change.

## Rebase check

`git fetch origin && git rebase origin/main` completed successfully (exit 0), rebasing onto `e0eb238`. Frozen installation, production rebuild, the exact issue test, workspace typecheck/lint/full suite, real Chromium harness, and dummy-token secret scan were all rerun afterward with exit 0. Final counts remain 45 issue tests and 188 workspace tests with zero failures. Log trailing whitespace was removed without changing their content or results; `git diff --check` passes.
