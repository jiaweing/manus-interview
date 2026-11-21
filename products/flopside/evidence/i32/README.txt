Issue #32 — Flopside settlement

Scope: products/flopside/packages/engine plus this evidence directory only.
Pure settleHand: unmatched refund against all contributors; main/side pots;
folded-seat exclusion; evaluator winners; clockwise-left-of-dealer odd chips;
sole-contender no-evaluation/no-exposure; showdown seat set; final stacks.
The existing betting progressBetting supplies all-in runout; no duplication.

Public API: handStatus gains "settled"; settlement is null on a new hand.
Result: reason, showdownSeatIndices, refunds, pots (amount/contributionLevel/
contributorSeatIndices/eligibleSeatIndices/winnerSeatIndices/payouts), seats
(seatIndex/contribution/refund/payout/netPayout/finalStack), totalChips, totalPot.
netPayout = payout + refund - original contribution. Pot amounts are historical
awards after settlement, NOT unresolved chips to add to final stacks.
#33 can settle after timeout applyAction leaves folded/showdown.
#34 can use progressBetting(startNextHand(settledState)).
#37 can reveal only showdownSeatIndices plus viewer-owned cards as permitted;
no ranks, best-five subsets or hole cards appear in the accounting result.
See packages/engine/README.md for the complete contract.

Settlement tests include 6000 injected-PRNG end-to-end random legal hands,
chained unequal-stack hands, deep-frozen input purity, an independent integer
chip-layer pot oracle, eligible winner checks and deterministic payout checks.
Logs in this directory retain commands, output and exit codes from final gates.

Unverified/out of scope:
- Docker build: not run, no docker in sandbox.
- Browser/e2e and real HTTP/WebSocket redaction: not run for this pure engine issue.
- Production deployment: not run; build gate is separate from deployment.
- Independent verifier rerun: not performed by this builder.
