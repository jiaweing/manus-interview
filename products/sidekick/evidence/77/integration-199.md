# PR #199 integration with secure proxy main

Integrated `origin/main` at `975c59ddf23c5e9531dcbf4364ed96507a22209b` into the independently verified #77 branch at `9c150b4326ac0c239ccf2fdd493a702d218abea6`. This is a merge into the PR branch, **not a merge of the PR into main**.

## Conflict resolution

Resolved 12 conflicted paths. The seven modify/delete conflicts retain #77's deletions of the popup scaffold and React/WXT logo assets. The background worker and runtime-only top-frame isolated content script retain #77's implementations. Server startup and root package scripts retain main/#197's secure proxy and secret-verification setup.

The WXT configuration combines #77's side-panel manifest, five browser permissions and optional demo hosts with #197's public `WXT_SIDEKICK_PROXY_URL` definition. It validates one public origin with `packages/config/src/proxy-url.ts` and supplies that origin to both the manifest and the existing `apps/extension/src/proxy.ts` mechanism. The manifest utility delegates to the shared validator; it does not implement another URL parser. The shared validator additionally rejects wildcard hosts. Manifest tests now use the existing extension proxy helper, reject paths/queries/fragments, and enforce explicit HTTPS in production. Setup documentation uses the canonical WXT public variable. Historical #77 evidence logs were stripped of trailing whitespace.

## Commands and results

The public build setting was exported as `WXT_SIDEKICK_PROXY_URL=https://8787-iew64p70hi5e7f4kbrn79-5b0a26b0.sg2.manus.computer`. This is not a token or key. Production WXT preparation requires the public origin; initial installation without it exited 1, and the configured frozen installation exited 0 with no lockfile changes.

| Command | Exit | Result |
| --- | ---: | --- |
| `bun install --frozen-lockfile` without public WXT origin | 1 | Production public-origin gate; no lockfile mismatch. |
| `bun install --frozen-lockfile` with public WXT origin exported | 0 | 509 installs checked across 567 packages, no changes. |
| `bun run fix` | 0 | One test-formatting fix; final rerun no changes. |
| `bun run check` | 0 | 31 files checked; final rerun also passed. |
| `bun run typecheck` | 0 | Server and extension TypeScript checks passed. |
| `bun test` without smoke credentials | 1 | 58 passed, 1 expected HTTPS hosting-gate failure, 208 assertions. |
| `bun --env-file=/home/ubuntu/wt/78/products/sidekick/.env test apps/server/tests/https.smoke.test.ts` | 1 | Builder env file/worktree no longer exists; credentials unavailable. |
| `bun run build:extension` | 0 | MV3 production build, 11 artifacts. |
| `bun test apps/extension/tests/manifest.test.ts` | 0 | 10 passed, 0 failed, 65 assertions. |
| `bun test apps/server/src/agent/security.test.ts` | 0 | 48 passed, 0 failed, 143 assertions. |
| `bun --env-file=<private fresh fixture> test apps/server/tests/https.smoke.test.ts` | 0 | 1 passed, 0 failed, 3 assertions against a finite integrated server over ephemeral HTTPS. |
| `bun --env-file=<private fresh fixture> test` | 0 | **59 passed, 0 failed, 211 assertions across all 3 test files.** |
| `bun --env-file=<private fresh fixture> run verify:secrets` | 0 | Tracked product files, 11 extension artifacts and security evidence logs scanned; no values printed. |
| `xvfb-run -a node /home/ubuntu/verify/integrate-199/browser-check.mjs` | 0 | Real headed `/usr/bin/chromium`, extension ENABLED, side-panel page rendered, zero runtime/manifest/page errors. |

The complete sanitized logs, built manifest, browser result and screenshots are in `integration-199/` beside this document. The final `git diff --check origin/main...HEAD` result is reported on the PR after committing this integration.

## Manifest and browser confirmation

The built manifest has `side_panel.default_path: "sidepanel.html"` and exactly `sidePanel`, `activeTab`, `scripting`, `tabs`, `storage`. The only required host is the configured HTTPS proxy. `https://en.wikipedia.org/*` and `https://httpbin.org/*` remain optional. There is no toolbar popup, automatic content injection, debugger, native messaging or background agent loop.

A fresh Chromium profile loaded the unpacked build with `--load-extension` under Xvfb. Its service worker started, Chrome reported ENABLED with empty runtime and manifest error arrays, and the Side Panel page displayed the Sidekick heading and expected text with no page errors. This is the requested short integration re-confirmation; the previous independent verifier's real toolbar-opening evidence remains in the original #77 evidence.

## Private credentials and limitations

The old server on port 8787 remained running, and an unauthenticated request to its ephemeral HTTPS turn endpoint returned 401. However, its builder worktree was deleted and the authorized `.env` path was unavailable, including via the running process's deleted working directory. No credentials were printed or recovered by inspecting process memory.

To run the complete smoke/full suite without weakening its gate or disturbing that server, a short-lived server from the integrated code was launched on port 8799 with a newly generated, high-entropy private fixture token and production HTTPS origin `https://8799-iew64p70hi5e7f4kbrn79-5b0a26b0.sg2.manus.computer`. The smoke test proved valid token → 400, missing token → 401, incorrect token → 401 without a model call. That finite server was stopped immediately after verification. The fixture environment is outside the repository and was never copied into evidence.

This proves temporary HTTPS routing only, **not durable hosting**. The #78 durable-hosting gate remains unmet. Real OpenRouter API check: **not run: no key**.
