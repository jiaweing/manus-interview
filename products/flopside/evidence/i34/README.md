# Issue #34 — lifecycle evidence

The gate logs in this directory are the authoritative results of commands run from `products/flopside` on the lifecycle branch after the final source edits and a fresh fetch/rebase onto `origin/main`. Each command and its exit code is retained in `verification.log`. `revision.log` records the source commit/base used for the gates (the subsequent evidence-only commit does not change tested product code).

- `fix.log`: `bun run fix`
- `install.log`: `bun install --frozen-lockfile`
- `lifecycle-test.log`: `bun test packages/engine/lifecycle.test.ts`
- `lint.log`: `bun run lint`
- `typecheck.log`: `bun run typecheck`
- `test.log`: `bun run test`
- `build.log`: `bun run build`

The lifecycle test logs include seeded per-roster match/hand/termination/rematch counts. The tests assert exact public result objects, deferred expiry, immutable repeated rejection, reset fields and IDs, conservation at every transition, and a ten-settled-hand bound. Fixture IDs and decks are injected through function parameters only; no real participants, credentials, private production cards or network payloads are logged.

Unverified/outside this issue: socket/HTTP viewer projections, live deadline/connection queue integration, browser/e2e lifecycle, published deployment, independent verifier rerun. This issue's verification section requires only engine tests, not browser e2e. Docker build: not run, no Docker in sandbox. No server code is modified and no development servers are started by this builder.
