# Issue #82 — bounded, private targeted observations

Run `bash evidence/82/verify.sh` from `products/sidekick`. The runner uses `WXT_SIDEKICK_PROXY_URL=https://example.com` consistently for the production build and manifest tests, which read the generated `.output/chrome-mv3` directory. It performs no provider network call. Chromium fixture permissions are granted only in disposable extension copies/profiles; production permissions are unchanged. The HTTPS hosting gate is deliberately separate and is not run by this runner.

## Shared exposure boundary and lead scope decision

`apps/extension/src/page/exposure.ts` exports `isExposed(Node | null)` for observation privacy (#82) and reuse by target identity (#83). Initial text, descriptor candidates and names, `aria-labelledby`/`aria-describedby` references, native `for`/wrapping labels, targeted excerpts, and `observer.findText` all use this boundary. `isRendered` remains an alias for compatibility, not a second implementation.

The contract is ordinary top-frame DOM, not universal geometric visibility. Every ancestor-or-self must avoid `display:none`, visibility hidden/collapse, `content-visibility:hidden`, `[hidden]`, `[inert]`, trimmed case-insensitive `aria-hidden=true`, template/noscript/script/style/datalist, and closed dialog. Closed-details filtering operates on the actual node, including direct text nodes: only the first direct summary and its descendants are exposed through a closed details. Referencing a rendered details container cannot expose its hidden body. Hidden references are ignored; exposed reference containers still have every descendant text node filtered. Unsupported iframe/canvas/object/embed subtrees remain excluded.

Browser-rendered state is determined with `checkVisibility({contentVisibilityAuto:true, visibilityProperty:true})` on the nearest ancestor-or-self that generates a box. **`display:contents` is transparent for that native box check, but never for explicit ancestor exclusions.** Its native false result/no rectangles must not hide visible prose, controls or reference labels beneath it. There is no opacity, position, positive-size, or client-rectangle requirement. Every `[hidden]` value is excluded, including `hidden=until-found` with a visible CSS override; revealed content is readable once the attribute is removed.

Native visibility is checked before computed-style reads can update skipped subtrees. Missing or throwing native/style state fails closed rather than admitting private text. There is no cross-observation exposure cache, so opening/closing details or changing attributes takes effect immediately.

### Direct-text auto-skipping regression

Chromium can report a `content-visibility:auto` container's own box visible while skipping its contents: `checkVisibility` checks skipped ancestors, not the receiver's own contents. For a text node whose nearest box is that auto container (including text through nested `display:contents` wrappers), native `innerText` on the box is empty while skipped. The predicate uses that only as a local boolean rendering gate. It never sends that string, inserts a probe node, or forces text layout using `Range`/rectangle measurement. Normal visible auto-container direct text has dedicated positive controls. Descendant box-generating elements are covered by the required native visibility options.

## Permanent regression matrix

`src/page/fixtures/exposure-matrix.ts` is shared by the unit suite and `tests/exposure.browser.ts`:

- **102 exclusion cases**, including all explicit exclusion classes, hidden/inert display overrides, native and overridden until-found, mixed-case/whitespace true ARIA-hidden, closed details direct/wrapped/nested/second-summary/no-summary content, nonrendered tags, closed dialog with a display override, and native render skipping. Explicit hidden/ARIA/inert/CSS exclusions are also tested on `display:contents` wrappers with visible descendants. **64 seeded fuzz combinations** vary attribute-name case, true-value case, whitespace, and nested disclosures/inert/content-visibility ancestors.
- **Six long-page positive cases**: normal visible text over 20,000 characters; a `display:contents` wrapper; nested boxless wrappers; mixed box/boxless wrappers; visible auto-container direct text; and visible auto direct text through a boxless wrapper. Each begins with more than 20,000 ordinary characters in a text node and has late direct/nested prose, a live reference link, a native label and referenced names/descriptions. Initial observations hit the text cap; targeted observation and `findText` recover the late evidence with fresh current-document indexes. The boxed/boxless positive fixtures retain ordinary visible content instead of solving privacy by dropping it.
- **Both reported repros** are permanent: the independent round-three visible `display:contents` late-passage/link failure is covered by the long-page boxless positive cases, and the direct-text auto-skipping leak is covered by two native-skipped cases (direct text on the visible auto box, and text through nested boxless wrappers). Browser evidence records that each skipped container's box reports visible while native contents remain empty; initial, targeted, find-text, nearby and provider-serialized observations exclude its UUID sentinel.

Every exclusion case has a fresh UUID sentinel in direct/nested prose, heading/button descriptor attributes, link metadata, native labels, referenced names/descriptions, and hidden fragments inside an otherwise exposed reference. Small fixtures prevent caps from concealing leaks. The production OpenRouter adapter serializes observations and tool results through a fake fetch transport, and assertions check the actual outbound body. Positive cases check that the body **does** include recoverable late evidence. Open summaries/details/dialogs, false ARIA-hidden, descriptions and opening/reclosing details also remain positive controls.

Happy DOM has no native layout/render skipping. Unit fixtures model Chromium's boxless false results, skipped descendants and empty native auto-container text; the headed packaged Chromium matrix uses native CSS and rendering without these mocks. Unit error cases explicitly test unavailable/throwing visibility, computed-style and auto-container text state. The missing-visibility mock restores its shared prototype so later positive/cap tests are not affected.

The previous ARIA editable-role/CSS-hidden regressions and cap/query tests remain intact. The issue suite proves zero cookie/storage/password getter reads and zero existing input-value reads during observation. Only explicit local equality checks read the ordinary input twice and return boolean outcomes. `outbound-provider.json` captures the production adapter's redacted permitted fixture, including `{ "matches": true, "status": "checked" }`, not an authorization header or existing sensitive value.

## Verification results for this scope revision

The complete runner passed with explicit exit **0** for every command in `summary.log`:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass |
| Production `WXT_SIDEKICK_PROXY_URL=https://example.com bun run build:extension` | Pass; rebuilt before manifest tests |
| Required issue command, `bun test apps/extension/src/page/snapshot-privacy.test.ts` | **141 pass, 0 fail, 2,797 assertions** |
| Full `bun test` suite, excluding the separately gated HTTPS smoke test | **307 pass, 0 fail, 3,551 assertions** |
| `bun run typecheck`, `bun run check`, `bun run verify:secrets` | Pass |
| `xvfb-run -a bun apps/extension/tests/snapshot-privacy.browser.ts` | Pass: both caps, late live index, document rotation, 21 seeded exclusions |
| `xvfb-run -a bun apps/extension/tests/exposure.browser.ts` | **102 exclusions + six long-page positives pass**, including 64 fuzz combinations, both repros and adapter serialization |

The Chromium executable is `/usr/bin/chromium`, headed under `xvfb-run -a`. `exposure-results.json` records every current matrix verdict and native skipped-container states. `exposure-display-contents.png` shows the real late passage/link through a boxless wrapper; `exposure-positive.png` and `exposure-collapsed.png` show the disclosure controls. `browser-results.json` retains the caps/identity/privacy evidence. All committed logs are stripped of trailing whitespace. The scanner uses an unlogged generated dummy input, not a real provider key.

The `verifier-*` logs retained from earlier rounds are **archival builder replays**, not fresh verification of this scope revision. Their source scripts were copied from `/home/ubuntu/verify/82/fixed/` to `/home/ubuntu/verify/82/systematic/`, changing only absolute repository/evidence destinations. The optional `SIDEKICK_VERIFIER_REPRO_DIR` runner hook remains available, but those historical scripts can encode superseded until-found/opacity expectations and were not used for the current result table. Builder replay is not a substitute for fresh independent verification.

## Known limitations / scope

- **Exotic layout is explicitly out of scope**, per the lead's PRD scope decision: CSS shapes, clip-path tricks, off-screen positioning, `opacity:0`, zero-size overflow clipping, shadow DOM and iframes are not acceptance failures. The predicate deliberately does not claim geometric/clipping/opacity secrecy; ordinary off-screen DOM can remain observable when the browser renders it. Actual native `content-visibility:auto` skipping is still excluded as described above.
- Support is ordinary top-frame DOM only; no shadow-root/iframe traversal or canvas/PDF control. Exotic accessibility/layout constructs beyond this definition have no universal guarantee.
- Browser-rendered state must be determinable. Unknown native state is excluded; the real Chromium positive matrix proves ordinary visible content is not wholesale dropped by that policy.
- Real OpenRouter API: **not run: no key**. All serialization checks use a fake transport with zero provider network calls.
- HTTPS hosting smoke gate: **not run**; issue #78 owns `bun run test:https` and its required deployment URL/token inputs. Its intentional missing-input failure was not changed or folded into `bun test`.
- Query matching is case-insensitive literal rendered-text search with whitespace normalization and bounded surrounding context, not semantic search.
- Privacy is structural exclusion of browser storage and editable/hidden content, not arbitrary secret detection in public prose or metadata.
- `findText` delegates to the observer's targeted pipeline; tool dispatch/scroll/fill execution and #83 integration remain separate issues. Target identity should import the exported exposure boundary rather than introduce another visibility implementation.
