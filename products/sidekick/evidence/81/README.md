# Issue #81 — indexed top-frame snapshots

## Implementation / integration surface

The packaged runtime content script installs one `SnapshotObserver` in the isolated world. Re-injecting `content-scripts/content.js` reuses that observer and its message listener. `createSnapshotObserver(document)` exports `observe(tabId)` and `resolveElement(snapshotId, documentToken, index)`. Every observation issues a new snapshot ID and replaces the live index map. A new Document or replacement of the document element rotates the document token. The target map never leaves the isolated world; normal page scripts cannot access it.

`observeTab(tabId, api)` is the panel-side API. It returns either `{status: "ready", snapshot}` or an explicit `{status: "paused", reason, message, canRequestAccess, origin?}`. It checks origin access before using #77's `contentScriptInjection` descriptor (packaged file, `world: "ISOLATED"`, `frameIds: [0]`) and then sends an observation request to frame 0. It does not start a background run or send text to a provider.

The separate `PageObserver` panel component presents Observe page, a labelled pause state, and an Allow access button. `requestOriginAccess(pause, api)` must be called synchronously from that button's user gesture, without awaiting a tab lookup first. It calls `chrome.permissions.request` only for one exact origin already listed in #77's optional demo origins. It never requests `<all_urls>`, and denial remains paused with no injection. This deliberately does not assume opening the toolbar's side panel grants activeTab.

Scope stays at observation: later #82 owns bounding/redaction/targeted observation and #83–#85 own action validation/dispatch. Snapshots here are not yet bounded (`truncated: false`); neither existing input/textarea values nor unsupported frame, shadow-root, canvas, or PDF descendants are read. Password/file/payment editing is not implemented. No model calls are made.

## Reproduction

From `products/sidekick`, with Bun on PATH:

```sh
bun install --frozen-lockfile
bun test apps/extension/src/page/snapshot.test.ts
bun test apps/extension/src/snapshot-client.test.ts
bun run typecheck
bun run check
WXT_SIDEKICK_PROXY_URL=https://proxy.example.com bun run build:extension
xvfb-run -a bun apps/extension/tests/snapshot.browser.ts
bun evidence/81/workspace-check.ts
```

The browser check requires `/usr/bin/chromium`, Xvfb and xdotool. It starts a finite local fixture server and loads the built extension. Its disposable test copy adds only that exact loopback fixture origin; the production manifest is not changed. It verifies all 15 fixture indexes resolve to the original DOM objects in the isolated world, excluded controls do not enter the map, re-injection rotates snapshot IDs but retains the document token, and a real reload rotates the document token.

The workspace-check script starts the actual Hono proxy factory over a finite localhost HTTPS listener with an ephemeral certificate and random dummy token. The certificate is explicitly trusted by the test subprocess, not by changing production TLS policy. It runs the entire `bun test` suite and the secret scanner, then deletes its certificate and stops the listener. This is **not** evidence of durable public HTTPS hosting (#78).

The build origin and `WXT_SIDEKICK_PROXY_URL` during manifest tests must match. Without privately supplied smoke-test env, the inherited HTTPS hosting gate correctly fails rather than skipping. `full-suite-no-smoke-env.log` records that expected gate failure; `full-suite.log` records the passing disposable HTTPS run.

## Captured verification

All final commands above exited 0. The named snapshot suite has **7 pass / 0 fail**; permission/dispatch tests have **6 pass / 0 fail**. The entire workspace suite has **72 pass / 0 fail** with the disposable HTTPS fixture. Frozen-lockfile installation, extension build, typecheck, Biome check, and the dummy-token secret scan passed.

Headed Chromium 156 captured actual snapshots on both requested pages:

| Target | Result | Indexed elements | Rendered characters |
| --- | --- | ---: | ---: |
| Local fixture | PASS | 15 | Fixture evidence checked |
| https://en.wikipedia.org/wiki/Ada_Lovelace | PASS | 1,459 | 74,042 |
| https://httpbin.org/forms/post | PASS | 25 | 181 |

`browser-results.json` records exact URLs/titles and outcomes. Screenshots are `local-fixture.png`, `missing-origin-paused.png` (320-pixel control), `wikipedia-live.png`, and `httpbin-live.png`. The real-site form check validates native Customer name/Telephone textbox descriptors; it does not fill or submit the form.

The pause control was tested as an extension tab with a **test-only selected-tab API adapter**, not a claim of native sidebar context verification. Its real Allow access button invoked Chrome's user-gesture permission request, but native approval completion is **unverified**. Exact optional origin grants were then installed in the disposable Chromium profile and independently confirmed using `chrome.permissions.contains` before real-site injection. Browser approval UI and native sidebar selected-tab selection still require a computer-use verifier.

No OpenRouter/provider API test was run: no key. No durable hosting was provisioned. No PRD ambiguity was introduced. One pre-existing Biome formatting error in `evidence/77/integration-199/manifest.json` was mechanically fixed (array layout only) to keep the whole workspace check green; no #77 runtime behavior changed.
