# Issue #82 — bounded, private targeted observations

Run `bash evidence/82/verify.sh` from `products/sidekick`. The runner uses `WXT_SIDEKICK_PROXY_URL=https://example.com` consistently for the production build and manifest tests. It performs no provider network call. Chromium fixture permissions are granted only in disposable extension copies/profiles; production permissions are unchanged. The HTTPS hosting gate is deliberately separate and is not run by this runner.

## One exposure boundary

`apps/extension/src/page/exposure.ts` defines `isExposed(Node)`. Initial text, descriptor candidates and names, `aria-labelledby`/`aria-describedby` references, native `for`/wrapping labels, targeted excerpts, and `observer.findText` all use this boundary. `isRendered` remains an alias for compatibility, not a second implementation. Every ancestor-or-self is checked for CSS display/visibility/content-visibility exclusions, hidden/inert, trimmed case-insensitive true ARIA-hidden values, nonrendered/unsupported tags, closed dialogs, and native `checkVisibility`. Opacity-zero exclusions from the existing implementation remain intact.

Closed-details filtering operates on the actual node, including direct text nodes: only the first direct summary and its descendants are exposed through a closed details. Referencing a rendered details container cannot expose its hidden body. Hidden references are ignored; exposed reference containers still have every descendant text node filtered. Native visibility is checked before computed-style/layout reads can force skipped subtrees to render. There is no cross-observation exposure cache, so opening/closing details or changing attributes takes effect immediately.

The hidden-until-found exception follows HTML's case-insensitive enumerated value without accepting invalid space-padded values. Unrevealed native until-found contents are still excluded by rendering/CSS checks. A rendered inline `content-visibility:visible` override is a positive control. Happy DOM has no layout/render skipping and lacks Chromium's until-found user-agent style: unit fixtures model layout rectangles, that UA style, and the browser-reported skipped result. Packaged Chromium uses native layout, CSS, and `checkVisibility` without those mocks.

## Permanent regression matrix

`src/page/fixtures/exposure-matrix.ts` is shared by the unit suite and `tests/exposure.browser.ts`. Its **94 cases** cover all exclusion classes, hidden/inert values with display overrides, invalid until-found whitespace, native until-found, mixed true ARIA-hidden case/whitespace, closed details direct/wrapped/nested/second-summary/no-summary content, nonrendered tags, closed dialog with a display override, and native render skipping. **64 seeded fuzz combinations** vary attribute-name case, true-value case, surrounding space/tab/CR/LF, and nested disclosures/inert/content-visibility ancestors.

Every matrix case has a fresh UUID sentinel in direct and nested prose, heading/button descriptor attributes, link metadata, native labels, referenced names/descriptions, and hidden fragments inside an otherwise exposed reference. It checks initial, sentinel-targeted, find-text, and visible-nearby targeted observations. The production OpenRouter adapter serializes these snapshots and tool results through a fake fetch transport, and assertions prove that the sentinel is absent from the actual outbound body. Small fixtures ensure caps cannot conceal leaks. Positive controls verify summary descendants, open details/dialogs, false ARIA-hidden, rendered until-found, exposed descriptions, and opening/reclosing details.

The previous ARIA editable-role/CSS-hidden regressions and all cap/query tests remain intact. The issue suite also proves zero cookie/storage/password getter reads and zero existing input-value reads during observation. Only explicit local equality checks read the ordinary input twice and return boolean outcomes. `outbound-provider.json` captures the production adapter's redacted permitted fixture, including `{ "matches": true, "status": "checked" }`, not an authorization header or existing sensitive value.

## Verification results

The complete runner passed with explicit exit **0** for every command in `summary.log`:

| Check | Result |
| --- | --- |
| Frozen dependency install and production build | Pass |
| Required issue command, `bun test apps/extension/src/page/snapshot-privacy.test.ts` | 124 pass, 0 fail, 2,444 assertions |
| Full `bun test` suite, excluding the separately gated HTTPS smoke test | 290 pass, 0 fail, 3,197 assertions |
| `bun run typecheck`, `bun run check`, `bun run verify:secrets` | Pass |
| Existing headed packaged Chromium privacy verification | Pass: both caps, late live index, document rotation, 21 seeded exclusions |
| New headed packaged Chromium exposure matrix | 94 cases pass, including 64 fuzz combinations and adapter serialization |
| Original verifier ARIA value suite | 4 pass, 0 fail, 12 assertions |
| Original verifier packaged browser repro | Pass, `failures:[]` |
| Verifier's new ARIA-hidden suite | 4 pass, 0 fail, 12 assertions |
| Verifier's new packaged browser repro | 57 cases, 0 failures |
| Verifier's original required issue fixture | 29 pass, 0 fail, 266 assertions |

Original verifier scripts were copied from `/home/ubuntu/verify/82/fixed/` to `/home/ubuntu/verify/82/systematic/`, changing only absolute repository and evidence destinations to point at this builder worktree. The original scripts/evidence were not modified. Replay command:

```bash
SIDEKICK_VERIFIER_REPRO_DIR=/home/ubuntu/verify/82/systematic bash evidence/82/verify.sh
```

The external replay directory is optional; the permanent unit/browser matrix and existing regressions remain runnable directly from the repository. Builder replay is not a substitute for fresh independent verification.

Full sanitized logs and exit codes are adjacent to this README. `exposure-results.json` records each matrix verdict, and `exposure-positive.png`/`exposure-collapsed.png` show real packaged Chromium positive controls and the invisible collapsed body. `browser-results.json` retains the existing caps/identity/privacy evidence. All committed logs are stripped of trailing whitespace. The scanner uses an unlogged generated dummy input, not a real provider key.

## Limitations / scope

- Real OpenRouter API: **not run: no key**. All serialization checks use a fake transport with zero provider network calls.
- HTTPS hosting smoke gate: **not run**; issue #78 owns `bun run test:https` and its required deployment URL/token inputs. Its intentional missing-input failure was not changed.
- Query matching is case-insensitive literal rendered-text search with whitespace normalization and bounded surrounding context, not semantic search.
- Privacy is structural exclusion of browser storage and editable/hidden content, not arbitrary secret detection in public prose or metadata.
- `findText` delegates to the observer's targeted pipeline; tool dispatch/scroll/fill execution remain separate issues. Top-frame-only limitations from #81 are unchanged.
