# Issue #33 — Authoritative injected-clock turn deadlines

Implementation: `packages/engine/deadline.ts`, with only an optional `public.turn` type addition in `state.ts`. Integration and API contracts are documented in `packages/engine/README.md` under **Deadline API (#33)**.

## Reproduction

From `products/flopside`, use Bun 1.4.5:

```sh
bun run fix
bun install --frozen-lockfile
bun test packages/engine/deadline.test.ts
bun run lint
bun run typecheck
bun run test
bun run build
```

The adjacent `.log` files contain captured output from the final verification run, and `gates.txt` records each command's exit status. These logs, not this manifest, are the pass/fail record. `rebase.log` records the pre-gate fetch/rebase against `origin/main`. No product code is edited after those final gates.

## Coverage

The focused file contains 18 tests: 12 deterministic cases and six seeded property cases. The seeded cases execute 6,000 completed hands across 2–4 seats, split evenly between timeout-only play and mixed random legal actions/timeouts. Clock and shuffle entropy are injected; there are no sleeps. Coverage includes the 11999/12000ms boundary, exact-once folds, late timeout deadlines, heads-up refund/settlement, multiway progression, legal checks still folding (preflop BB option and postflop), connection changes/resume/view cloning without renewal, all timer-identity components, the same actor returning on the same street, no turns for all-in/inactive/folded seats, blind-only runout, unchanged rejected actions, purity, JSON shape, chip conservation, and bounded termination.

## Queue handoff

Import `TURN_MS`, `TurnDeadline`, `assignDeadline`, `startMatchAt`, `startNextHandAt`, `applyActionAt`, `progressBettingAt`, `advanceStreetAt`, and `expireTurn` from `@flopside/engine/deadline`. Each `At` wrapper receives `nowMs` explicitly. Timed active states expose `{ actorIndex, handNumber, street, turnId, deadlineAt }`; settled states have `public.turn: null`. An accepted action/expiry settles completed hands automatically; lifecycle callers must not double-settle.

The room queue captures the current turn and room/match generation. At its scheduled callback it checks the generation, enters the same serialized mutation queue as commands, reads the latest state, and calls `expireTurn(latestState, capturedTurn, currentServerNowMs)`. Only an `expired: true` result should advance room revision or broadcast. It then schedules the new turn or passes the settled state to lifecycle. Early callbacks reschedule the same absolute deadline; stale callbacks are identical-state no-ops. Connection changes never restart timers. At the command boundary, expire any due current turn before validating betting intent. Match-generation fencing is required across rematches that reset hand numbering.

## Unverified / out of scope

- Docker build: not run, no docker in sandbox.
- Real socket scheduling, room revision integration, rematch-generation guards, network redaction and browser reconnect/e2e: not run for this pure-engine issue; integration belongs to #34/#37/#38/#39 and subsequent verification issues.
- Independent verifier rerun: not performed by the builder.
