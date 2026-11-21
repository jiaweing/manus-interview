# Issue #34 — lifecycle evidence

The current round-2 handoff is documented in [ROUND2.md](ROUND2.md), with authoritative final gates in `round2-verification.log`, tested revision/hashes in `round2-revision.log`, and output in the individual `round2-*.log` files. Both the exact lifecycle/deadline focused command and the additional composition suite are included. Managed rooms use `startLifecycleMatchAt`, accepted `applyActionAt` → `advanceMatchAt`, `expireTurnAndAdvanceAt`, and `rematchAt`; never `startNextHandAt` or an `assignDeadline`-only lifecycle handoff. Room/match-generation fencing remains #38's adapter responsibility.

The non-prefixed gate logs below are retained historical round-1 results of commands run from `products/flopside` after those source edits and a fresh fetch/rebase onto the then-current `origin/main`. Each command and its exit code is retained in `verification.log`. `revision.log` records the source commit/base used for those gates (the subsequent evidence-only commit does not change tested product code).

- `fix.log`: `bun run fix`
- `install.log`: `bun install --frozen-lockfile`
- `lifecycle-test.log`: `bun test packages/engine/lifecycle.test.ts`
- `lint.log`: `bun run lint`
- `typecheck.log`: `bun run typecheck`
- `test.log`: `bun run test`
- `build.log`: `bun run build`

The lifecycle test logs include seeded per-roster match/hand/termination/rematch counts. The tests assert exact public result objects, deferred expiry, immutable repeated rejection, reset fields and IDs, conservation at every transition, and a ten-settled-hand bound. Fixture IDs and decks are injected through function parameters only; no real participants, credentials, private production cards or network payloads are logged.

Unverified/outside this issue: socket/HTTP viewer projections, live deadline/connection queue integration, browser/e2e lifecycle, published deployment, independent verifier rerun. This issue's verification section requires only engine tests, not browser e2e. Docker build: not run, no Docker in sandbox. No server code is modified and no development servers are started by this builder.
