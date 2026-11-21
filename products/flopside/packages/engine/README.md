# Dealing and state (#30)

Import modules by subpath (`@flopside/engine/dealing`, `/state`, `/shuffle`, `/cards`); there is no barrel. This package is authoritative server rules code, not client state or a transport reducer.

## Data boundary

`MatchState` is plain serializable `{ public, private }` data. `public` contains the roster (stable seat indices and IDs), stacks, street/hand contributions, `inHand`/`folded`/`allIn` flags, hand number, dealer and blind indices, fixed 5/10 blinds, board, street, and actor. `private` contains the complete 52-card permutation, `nextCardIndex`, and seat-indexed hole-card arrays (empty for inactive seats). Neither the complete match state nor its private object may be sent to clients or logged. #37 must project viewer-specific cards and events separately.

No revisions, tokens, room metadata, connectivity, RNG functions or timestamps are stored here. These belong to the room/transport layers; #33 can extend the reducer with an injected clock and deadline without adding ambient time reads.

## Transitions

- `startMatch(seats: readonly SeatInput[], deckSource?: DeckSource): MatchState` validates 2–4 unique nonempty seat IDs, allocates 200 chips to each, and deals hand 1 with dealer index 0. Stacks shown in the returned hand already have blinds deducted; `stack + handContribution` is initially 200 per seat.
- `startNextHand(state, deckSource?): MatchState` preserves settled stacks, rotates to the next positive-stack seat, resets per-hand fields, posts short blinds up to the available stack, and deals anew. **The caller must settle/refund the previous hand first.** It refuses fewer than two funded seats; #34 decides match end/rematch rather than calling this after a bust. Busted seats remain at stable indices with `inHand: false` and no cards. A seat that posts its full stack is all-in but remains `inHand: true` for this hand.
- `advanceStreet(state): MatchState` deals flop/turn/river, resets street contributions only, preserves total hand contributions/stacks/flags/hole cards, and selects the first eligible postflop actor. River cannot advance; #32 must settle it. It can be called repeatedly for a runout even with `actor: null`.
- `nextActor(state, afterIndex = actor ?? dealerIndex): number | null` scans clockwise **after** the anchor, skipping inactive, folded, all-in, and zero-stack seats. It returns null when none can act; with one eligible seat it may return that same seat after wrapping. **It is order, not betting-round completion.** #31 must track acted/raise rights and close the round or run out when betting cannot continue.

The extension slot for #31 is an `applyAction(state, action)` entry point in a dedicated betting module (or added to dealing if needed), composing these transitions. No placeholder betting implementation, wager validation, turn completion, side pots, settlement, deadline, termination or rematch logic is supplied by #30. Tests simulate fold/all-in/settlement by editing plain fixture state, not by introducing a production command shortcut.

All transitions leave their input state untouched. Returned states can share unchanged private arrays with previous states; callers must treat reducer states as immutable rather than mutate those arrays. Deck-source cards are cloned at the hand boundary so the caller's fixture cannot mutate an active deck.

## Deal and shuffle

There are **no burn cards**. Hole cards are dealt one at a time clockwise starting left of the dealer, for two rounds, skipping inactive seats. The board then consumes the next 3/1/1 cards. A hand's full permutation is retained privately with a cursor, so every dealt card is accounted for exactly once.

The production default is `productionDeck()` in `shuffle.ts`, which supplies `fullDeck()` to Fisher–Yates. `boundedIndex()` rejects uint32 values in the incomplete high modulo bucket before reducing modulo the current bound. Its default source is `cryptoUint32()` using `node:crypto`'s `webcrypto.getRandomValues`; the Node import makes this a server-only module. There are no ambient configuration/environment selectors, non-cryptographic fallbacks, or stored random sources.

A deterministic `DeckSource = () => readonly Card[]` is injectable **only as a function parameter** to start functions; every supplied deck is checked for a valid complete 52-card permutation. Entropy injection into `boundedIndex`/`shuffleDeck` is likewise a function parameter for isolated shuffle tests, never configuration. **#36+ must gate any deterministic deck wiring in a labeled test deployment behind a test flag, verify the flag is off in the production build, and never accept fixture/deck selection from a client.** This package does not implement that room/deployment gate.

Run `bun test packages/engine/dealing.test.ts` from the product root. Tests cover deterministic 2/3/4-seat orders and blinds, rotation, short blinds, card uniqueness and street counts, purity/JSON shape, rejection boundaries, deterministic distribution smoke checks (not a proof of cryptographic strength), small-deck permutation reachability, production 52-card permutations, and a source scan forbidding non-cryptographic randomness in all engine TypeScript files.
