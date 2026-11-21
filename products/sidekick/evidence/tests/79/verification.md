# Issue #79 — validated OpenRouter single-tool turns

Branch: `sidekick/79-openrouter-turn`. All changes are under `products/sidekick`. Reused the existing #78 `TurnAdapter`, authenticated route, bounded UTF-8 reader, rate limiter, CORS setup, and no-body-logging error handler. No extension UI/content-script changes, new dependencies, lockfile changes, provider picker, or browser execution code were added.

Shared Zod schemas and inferred types live at `packages/protocol/src/index.ts`; the browser-safe module imports only the existing Zod dependency. Exact shapes and integration notes are in `packages/protocol/README.md`. The server-only OpenRouter adapter captures one environment-fixed model at startup, uses a fixed HTTPS Chat Completions endpoint, disallows redirects/parallel calls, and independently validates every output. Invalid requests/transcript IDs fail before adapter dispatch; invalid/multiple/unknown calls produce no action. Original call IDs survive both wire conversions. The 20-second model deadline is tested in real elapsed time with an uncooperative fake adapter; request abort also invalidates a immediately-resolved late call.

## Final post-rebase verification

Working directory for every command: `/home/ubuntu/wt/79/products/sidekick`. Bun 1.4.5. The branch was rebased onto current `origin/main` (`4eb9f44`) before this complete verification run. The required issue order **build → turn tests → typecheck** was followed.

| Exact command | Exit | Result / captured log |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | 509 installs / 567 packages, no changes; `install.log`. No env required. |
| `WXT_SIDEKICK_PROXY_URL=https://proxy.example.com OPENROUTER_API_KEY=SERVER_KEY_SENTINEL_NOT_A_REAL_KEY_79 bun run build:extension` | 0 | WXT Chrome MV3 build; `build-extension.log`. The provider value is a deliberate non-secret sentinel. |
| `bun test apps/server/src/agent/turn.test.ts` | 0 | **72 pass, 0 fail, 290 assertions**; `turn.log`. |
| `bun run typecheck` | 0 | Server and extension TypeScript; `typecheck.log`. |
| `bun test apps/server/src/agent/security.test.ts` | 0 | **48 pass, 0 fail, 143 assertions**; `security.log`. |
| `bun run check` | 0 | 38 files checked, no fixes; `check.log`. |
| `bun --env-file=/tmp/sidekick79-test.env test apps/server/tests/https.smoke.test.ts` | 0 | **1 pass, 0 fail, 3 assertions**; `https-smoke.log`. Temporary HTTPS routing only. |
| `WXT_SIDEKICK_PROXY_URL=https://proxy.example.com bun --env-file=/tmp/sidekick79-test.env test` | 0 | **131 pass, 0 fail, 501 assertions**, 4 files; `full-suite.log`. Build and test public URLs match. |
| `bun --env-file=/tmp/sidekick79-test.env run verify:secrets` | 0 | Tracked product files, 11 extension artifacts and evidence logs scanned without printing values; `secret-scan.log`. |
| `git diff --check` | 0 | No whitespace errors. |
| `bun test apps/server/tests/https.smoke.test.ts` without env | 1 | Expected inherited missing-host/token gate: **0 pass, 1 fail**, no smoke requests run; `https-missing-env.log`. Not a passing skip. |

The private mode-0600 `/tmp/sidekick79-test.env` contained a generated verification-only bearer token, `NODE_ENV=production`, port 8791, and the public ephemeral forwarding origin `https://8791-iew64p70hi5e7f4kbrn79-5b0a26b0.sg2.manus.computer`. No provider key was configured. Its contents/token are not captured or committed. A temporary process was started with `bun --env-file=/tmp/sidekick79-test.env apps/server/src/index.ts`, exercised only with malformed/auth smoke requests, and stopped after verification. The extension was not deployed against the documentation-only `proxy.example.com` build origin.

The whole-workspace formatter required one **formatting-only** change to the previously committed `evidence/77/integration-199/manifest.json` permissions array; its JSON data is unchanged. This removes a pre-existing `bun run check` failure. `fix.log` retains the first development lint failure; `fix-final.log` and all final suite logs show the corrected results. An initial full-suite attempt also caught mismatched WXT build/test public origins; the final run above supplies the same public URL. No test expectations were weakened to hide those failures.

## Coverage and limitations

The fake contract adapter/fake HTTP transport tests cover zero/one-call responses for all eight tools, exact call/result ID round-trips, strict schemas and every tool signature, malformed/unknown/multiple calls, invalid/unmatched/duplicate/interleaved/unresolved transcript IDs, server-fixed/default model selection, no browser dispatch, sanitized HTTP/network/protocol errors without retries, 20-second abort, Stop/request cancellation, and absence of a seeded server-key sentinel or server adapter in every generated extension artifact. Existing #78 security tests remain green with complete validated fixtures; byte/rate/auth/logging protections are preserved.

Real OpenRouter/API/model-availability check: **not run: no key**. `anthropic/claude-sonnet-5.5` remains the PRD's unverified default candidate; no silent model/provider substitution was made. The issue's Verification sentence requesting a “fixed Google adapter/model selection” is inconsistent with its OpenRouter-only tasks and the PRD; the explicit OpenRouter requirement governs.

Durable HTTPS hosting remains **unverified / unmet**, as already tracked by #78: the sandbox forwarding URL is temporary, not a supplied permanent deployment. Bare smoke/full-suite runs without host/token configuration still fail by design. Extension execution, local redaction, stale-target checks, confirmation, and evidence-based completion remain the responsibility of their assigned downstream issues; schema validation and an untrusted-data prompt do not replace those controls or guarantee prompt-injection immunity.
