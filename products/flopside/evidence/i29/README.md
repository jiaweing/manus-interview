# Issue #29 — evaluator evidence

Scope: `packages/engine/evaluator.ts` and `packages/engine/evaluator.test.ts`; no dependency, app, shared-card, dealing, or ledger changes.

## API

Import through `@flopside/engine/evaluator` (no barrel file). `evaluateBest(cards: Card[]): EvaluatedHand` accepts 5–7 distinct cards from the shared `./cards` contract and returns `category` (0–8), ordered `tiebreak`, `bestFive` (five original card references), and human-readable `label`. Invalid counts or duplicate physical cards throw `RangeError`. The evaluator does not mutate inputs and uses no I/O, clock, or randomness.

`compareHands(a: HandRank, b: HandRank): -1 | 0 | 1` compares category, then lexicographic tiebreaks; positive means the first hand wins. Suits and unused cards cannot break ties. `HandCategory`, `HandRank`, `EvaluatedHand`, and `HAND_LABELS` are exported. Equal winning subsets may have multiple representatives; selected cards follow rank-group order, preserving input order only when choosing among equivalent suits.

Tiebreak vectors: high card/flush = five descending ranks; one pair = pair rank then three kickers; two pair = higher pair, lower pair, kicker; trips = trips rank then two kickers; straight/straight flush = highest rank (wheel = 5); full house = trips rank then pair rank; quads = quads rank then kicker. Royal flush is category 8, `[14]`, labeled “Straight flush”.

## Verification

Commands were run from `products/flopside/` after the final source edit and `git rebase origin/main`. `bun run fix` completed successfully before the final checks. Every command below exited 0; full small logs are alongside this file.

| Command | Result | Log |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Passed; no lockfile changes | `install.log` |
| `bun test packages/engine/evaluator.test.ts` | 49 passed, 0 failed, 18,330 assertions | `evaluator.log` |
| `bun run lint` | Passed; 34 files checked, no fixes | `lint.log` |
| `bun run typecheck` | Passed across web, server, engine and root | `typecheck.log` |
| `bun run test` | 55 passed across 3 files, 0 failed, 18,345 assertions | `test.log` |
| `bun run build` | Passed: Next static export and Bun server bundle | `build.log` |

The exhaustive check evaluates every one of the 2,598,960 five-card hands in the canonical deck. The expected category counts, in category order 0–8, are `[1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]`; all match, including four ace-high straight flushes. It took about 2.47 seconds in the focused final run (20-second test timeout).

The differential/property test samples 3,000 seven-card hands using an injected seeded Park–Miller PRNG, compares direct evaluation against all 21 five-card subsets, re-evaluates the selected best five, verifies subset membership and order independence, and asserts ranks cannot worsen when cards are added. It took about 192 ms. Failure contexts contain explicit synthetic card inputs and expected ranks, plus seed/iteration for randomized cases.

Explicit tests cover all categories, wheel versus six-high, no ace wrapping (also within a flush), royal/wheel straight flushes, a mixed-suit straight coexisting with a flush, seven-card flush selection, two trips, best pair from multiple candidates, quads kickers, all kicker positions exercised by fixtures, three pairs, board-only ties, suit-independent ties, and split-pot-style equality.

## Not verified / not applicable

- Independent clean-worktree verification is the separate verifier’s responsibility; these are builder results.
- Browser e2e: not run; issue #29 has only pure engine verification, no browser requirement.
- Docker build: not run, no docker in sandbox.
- No live-game data, real API calls, or deployment changes were used or required.
