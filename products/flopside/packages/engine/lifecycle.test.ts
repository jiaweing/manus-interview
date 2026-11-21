import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert/strict";
import { applyAction, type BettingAction, legalActions } from "./betting";
import { cardCode, cards, fullDeck } from "./cards";
import {
	advanceMatch,
	type IdGenerator,
	MAX_HANDS,
	type MatchResult,
	rematch,
	requestExpiryTermination,
	startLifecycleMatch,
} from "./lifecycle";
import { settleHand } from "./settlement";
import { boundedIndex, shuffleDeck, type Uint32Source } from "./shuffle";
import type { MatchState } from "./state";

function ids(): IdGenerator {
	let counter = 0;
	return (kind) => {
		counter += 1;
		return `${kind}-${counter}`;
	};
}
function roster(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `seat-${index * 2}`,
	}));
}
function match(count = 2, newIds = ids()): MatchState {
	return startLifecycleMatch(roster(count), fullDeck, newIds);
}
function connected(state: MatchState): Set<string> {
	return new Set(state.public.seats.map((seat) => seat.id));
}
function chips(state: MatchState): number {
	return state.public.seats.reduce(
		(sum, seat) => sum + seat.stack + seat.handContribution,
		0
	);
}
function freezeTree(value: unknown): void {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			freezeTree(child);
		}
		Object.freeze(value);
	}
}
function pure<T>(state: MatchState, operation: () => T): T {
	const before = JSON.stringify(state);
	freezeTree(state);
	const output = operation();
	assert.equal(JSON.stringify(state), before, "transition mutated its input");
	return output;
}
function action(state: MatchState, bettingAction: BettingAction): MatchState {
	const { actor } = state.public;
	assert.notEqual(actor, null);
	const result = pure(state, () =>
		applyAction(state, actor as number, bettingAction)
	);
	assert.ok(result.ok);
	assert.equal(chips(result.state), chips(state));
	return result.state;
}
function checkCall(state: MatchState): MatchState {
	let current = state;
	let steps = 0;
	while (current.public.handStatus === "playing") {
		steps += 1;
		assert.ok(steps < 100);
		const legal = legalActions(current, current.public.actor as number);
		current = action(current, {
			type: legal.actions.some((offered) => offered.type === "check")
				? "check"
				: "call",
		});
	}
	return current;
}
function tieDeck(count: number) {
	const prefix = [
		...cards("2c 3c 4c 5c 6c 7c 8c 9c").slice(0, count * 2),
		...cards("Th Jh Qh Kh Ah"),
	];
	const used = new Set(prefix.map(cardCode));
	return () => [
		...prefix,
		...fullDeck().filter((card) => !used.has(cardCode(card))),
	];
}
/** A valid completed showdown; settlement, not lifecycle, awards all chips. */
function showdown(stacks: number[], handNumber = 1): MatchState {
	const state = match(stacks.length);
	state.public.actor = null;
	state.public.board = cards("Th Jh Qh Kh Ah");
	state.public.street = "river";
	state.public.handStatus = "showdown";
	state.public.handNumber = handNumber;
	state.private.holeCards = ["2c 3c", "4c 5c", "6c 7c", "8c 9c"]
		.slice(0, stacks.length)
		.map(cards);
	for (const [index, seat] of state.public.seats.entries()) {
		seat.stack = stacks[index] as number;
		seat.handContribution = 0;
		seat.streetContribution = 0;
		seat.allIn = seat.stack === 0;
		seat.raiseAllowed = false;
	}
	return state;
}
function settled(stacks: number[], handNumber = 1): MatchState {
	const state = showdown(stacks, handNumber);
	return pure(state, () => settleHand(state));
}
function finishFixture(stacks: number[], handNumber = MAX_HANDS): MatchState {
	const state = settled(stacks, handNumber);
	return pure(state, () => advanceMatch(state, fullDeck, ids()));
}
function expected(
	stacks: number[],
	winnerSeatIds: string[],
	terminationReason: MatchResult["terminationReason"]
): MatchResult {
	return {
		finalStacks: stacks.map((stack, index) => ({
			seatId: `seat-${index * 2}`,
			stack,
		})),
		terminationReason,
		winnerSeatIds,
	};
}

describe("post-settlement match lifecycle", () => {
	test("all-in zero stacks do not finish until settlement determines the bust winner", () => {
		let state = match();
		state.public.board = cards("2c 4d 7h 9s Jc");
		state.private.holeCards = [cards("As Ah"), cards("Ks Kh")];
		state.public.actor = null;
		state.public.street = "river";
		state.public.handStatus = "showdown";
		for (const seat of state.public.seats) {
			seat.stack = 0;
			seat.handContribution = 200;
			seat.streetContribution = 200;
			seat.allIn = true;
		}
		expect(pure(state, () => advanceMatch(state, fullDeck, ids()))).toBe(state);
		expect(state.public.result).toBeNull();
		state = pure(state, () => settleHand(state));
		const finished = pure(state, () => advanceMatch(state, fullDeck, ids()));
		expect(finished.public.result).toEqual(
			expected([400, 0], ["seat-0"], "bust")
		);
		expect(finished.public.handNumber).toBe(1);
		expect(finished.public.settlement).toBe(state.public.settlement);
		expect(chips(finished)).toBe(400);
	});
	test("live betting and folded ready-to-settle states are lifecycle identity no-ops", () => {
		const live = match();
		expect(pure(live, () => advanceMatch(live, fullDeck, ids()))).toBe(live);
		const folded = action(live, { type: "fold" });
		expect(folded.public.handStatus).toBe("folded");
		expect(pure(folded, () => advanceMatch(folded, fullDeck, ids()))).toBe(
			folded
		);
	});
	test("hands 1–9 continue with rotated dealer; exactly the tenth settled hand finishes", () => {
		const newIds = ids();
		const source = tieDeck(3);
		let state = startLifecycleMatch(roster(3), source, newIds);
		const { matchId } = state.public;
		for (let hand = 1; hand <= MAX_HANDS; hand += 1) {
			expect(state.public.handNumber).toBe(hand);
			expect(state.public.dealerIndex).toBe((hand - 1) % 3);
			state = checkCall(state);
			expect(pure(state, () => advanceMatch(state, source, newIds))).toBe(
				state
			);
			state = pure(state, () => settleHand(state));
			const priorHandId = state.public.handId;
			state = pure(state, () => advanceMatch(state, source, newIds));
			expect(state.public.matchId).toBe(matchId);
			expect(chips(state)).toBe(600);
			if (hand < MAX_HANDS) {
				expect(state.public.result).toBeNull();
				expect(state.public.handId).not.toBe(priorHandId);
				expect(state.public.settlement).toBeNull();
			} else {
				expect(state.public.handId).toBe(priorHandId);
				expect(state.public.result).toEqual(
					expected(
						[200, 200, 200],
						["seat-0", "seat-2", "seat-4"],
						"hands_complete"
					)
				);
			}
		}
	});
	test("normal tied highest stacks share victory, not all seats", () => {
		expect(finishFixture([250, 250, 100]).public.result).toEqual(
			expected([250, 250, 100], ["seat-0", "seat-2"], "hands_complete")
		);
	});
	test("a bust on hand ten takes precedence and tied leaders still share victory", () => {
		expect(finishFixture([300, 300, 0]).public.result).toEqual(
			expected([300, 300, 0], ["seat-0", "seat-2"], "bust")
		);
	});
	test("new-hand composition normalizes blind-only all-ins rather than leaving a phantom actor", () => {
		const state = settled([7, 3]);
		const next = pure(state, () => advanceMatch(state, fullDeck, ids()));
		expect(next.public.handNumber).toBe(2);
		expect(next.public.dealerIndex).toBe(1);
		expect(next.public.handStatus).toBe("showdown");
		expect(next.public.actor).toBeNull();
		expect(next.public.board).toHaveLength(5);
		expect(chips(next)).toBe(10);
	});
	test("finished result is stored once and repeated transitions/expiry cannot overwrite it", () => {
		const state = finishFixture([400, 0]);
		const resultBytes = JSON.stringify(state.public.result);
		const never = () => {
			throw new Error("source must not be called");
		};
		for (let repeat = 0; repeat < 4; repeat += 1) {
			expect(pure(state, () => advanceMatch(state, never, never))).toBe(state);
			expect(
				pure(state, () => requestExpiryTermination(state, new Set()))
			).toBe(state);
			expect(JSON.stringify(state.public.result)).toBe(resultBytes);
		}
	});
	test("malformed settled boundaries reject without mutation", () => {
		for (const corrupt of [
			(state: MatchState) => {
				state.public.settlement = null;
			},
			(state: MatchState) => {
				state.public.actor = 0;
			},
			(state: MatchState) => {
				state.public.handNumber = 11;
			},
			(state: MatchState) => {
				const [seat] = state.public.seats;
				assert.ok(seat);
				seat.handContribution = 1;
			},
		]) {
			const state = structuredClone(settled([200, 200]));
			corrupt(state);
			pure(state, () =>
				expect(() => advanceMatch(state, fullDeck, ids())).toThrow()
			);
		}
	});
});

describe("deferred seat expiry", () => {
	test("expiry uses connected tied leaders, excluding a richer disconnected seat", () => {
		const state = settled([300, 300, 100, 100]);
		const pending = pure(state, () =>
			requestExpiryTermination(state, new Set(["seat-4", "seat-6", "unknown"]))
		);
		const finished = pure(pending, () =>
			advanceMatch(pending, fullDeck, ids())
		);
		expect(finished.public.result).toEqual(
			expected([300, 300, 100, 100], ["seat-4", "seat-6"], "seat_expired")
		);
	});
	test("no connected participants means abandoned, with no winners but all final stacks", () => {
		const state = settled([250, 150]);
		const pending = requestExpiryTermination(state, new Set(["unknown"]));
		expect(advanceMatch(pending, fullDeck, ids()).public.result).toEqual(
			expected([250, 150], [], "abandoned")
		);
	});
	test("pending expiry does not alter public state, legal actions, cards, or settlement", () => {
		let state = match();
		const original = state;
		const seatIds = connected(state);
		state = pure(state, () => requestExpiryTermination(state, seatIds));
		seatIds.clear(); // The request must own its snapshot, not retain the caller's set.
		expect(state.public).toBe(original.public);
		expect(state.private.deck).toBe(original.private.deck);
		expect(state.private.holeCards).toBe(original.private.holeCards);
		expect(legalActions(state, state.public.actor as number)).toEqual(
			legalActions(original, original.public.actor as number)
		);
		expect(pure(state, () => advanceMatch(state, fullDeck, ids()))).toBe(state);
		state = action(state, { totalTo: 75, type: "raise" });
		state = action(state, { type: "fold" });
		expect(state.public.result).toBeNull();
		expect(pure(state, () => advanceMatch(state, fullDeck, ids()))).toBe(state);
		const control = settleHand({
			...state,
			private: { ...state.private, pendingExpiryConnectedSeatIds: null },
		});
		state = pure(state, () => settleHand(state));
		expect(state.public).toEqual(control.public);
		const finished = pure(state, () => advanceMatch(state, fullDeck, ids()));
		expect(finished.public.result).toEqual(
			expected([210, 190], ["seat-0"], "seat_expired")
		);
		expect(finished.public.settlement?.refunds).toEqual([
			{ amount: 65, seatIndex: 0 },
		]);
	});
	test("expiry chooses leaders after payout, not when the request was made", () => {
		let state = match();
		state = requestExpiryTermination(state, connected(state));
		state = action(state, { type: "fold" });
		state = settleHand(state);
		expect(advanceMatch(state, fullDeck, ids()).public.result).toEqual(
			expected([195, 205], ["seat-2"], "seat_expired")
		);
	});
	test("latest boundary connectivity overrides the request snapshot; expiry beats bust and ten hands", () => {
		const state = settled([400, 0], MAX_HANDS);
		const pending = requestExpiryTermination(state, new Set(["seat-0"]));
		expect(
			advanceMatch(pending, fullDeck, ids(), new Set(["seat-2"])).public.result
		).toEqual(expected([400, 0], ["seat-2"], "seat_expired"));
		expect(
			advanceMatch(pending, fullDeck, ids(), new Set()).public.result
		).toEqual(expected([400, 0], [], "abandoned"));
	});
	test("repeated pending requests refresh the connected-seat snapshot without mutation", () => {
		const original = match();
		const pending = pure(original, () =>
			requestExpiryTermination(original, connected(original))
		);
		const updated = pure(pending, () =>
			requestExpiryTermination(pending, new Set())
		);
		expect(pending.private.pendingExpiryConnectedSeatIds).toEqual([
			"seat-0",
			"seat-2",
		]);
		expect(updated.private.pendingExpiryConnectedSeatIds).toEqual([]);
		expect(updated.public).toBe(original.public);
	});
});

describe("host-controlled same-room rematch", () => {
	const never = () => {
		throw new Error("rejected rematch invoked a source");
	};
	for (const [name, requester, host, seatIds] of [
		["non-host", "seat-2", "seat-0", ["seat-0", "seat-2"]],
		["host with zero connected seats", "seat-0", "seat-0", []],
		["host with one connected seat", "seat-0", "seat-0", ["seat-0"]],
		[
			"unknown IDs cannot satisfy quorum",
			"seat-0",
			"seat-0",
			["seat-0", "unknown"],
		],
		["disconnected host", "seat-0", "seat-0", ["seat-2", "seat-4"]],
	] as const) {
		test(`${name}: repeated rejection preserves byte-equal result and exact state identity`, () => {
			const state = finishFixture([250, 250, 100]);
			const bytes = JSON.stringify(state);
			const resultBytes = JSON.stringify(state.public.result);
			for (let repeat = 0; repeat < 5; repeat += 1) {
				const rejected = pure(state, () =>
					rematch(state, requester, host, new Set(seatIds), never, never)
				);
				expect(rejected).toEqual({
					error: { code: "ILLEGAL_ACTION", message: expect.any(String) },
					ok: false,
					state,
				});
				expect(rejected.state).toBe(state);
				expect(rejected.state.public.result).toBe(state.public.result);
				expect(JSON.stringify(rejected.state.public.result)).toBe(resultBytes);
				expect(JSON.stringify(state)).toBe(bytes);
			}
		});
	}
	test("live or merely settled unfinished matches cannot rematch", () => {
		for (const state of [match(), settled([200, 200])]) {
			const rejected = pure(state, () =>
				rematch(state, "seat-0", "seat-0", connected(state), never, never)
			);
			expect(rejected.ok).toBe(false);
			expect(rejected.state).toBe(state);
		}
	});
	test("successful rematch resets connected seats, stacks before blinds, dealer, counters, cards, results and IDs", () => {
		const old = finishFixture([300, 200, 100], MAX_HANDS);
		const state = {
			...old,
			public: {
				...old.public,
				oldTurnMarker: "must-not-survive",
				roomCode: "ABC123",
			},
			roomCode: "ABC123",
		};
		const result = pure(state, () =>
			rematch(
				state,
				"seat-0",
				"seat-0",
				new Set(["seat-0", "seat-4"]),
				tieDeck(2),
				(kind) => `new-${kind}`
			)
		);
		assert.ok(result.ok);
		const fresh = result.state;
		expect("roomCode" in fresh && fresh.roomCode).toBe("ABC123");
		expect("roomCode" in fresh.public && fresh.public.roomCode).toBe("ABC123");
		expect("oldTurnMarker" in fresh.public).toBe(false);
		expect(fresh.public.seats.map((seat) => seat.id)).toEqual([
			"seat-0",
			"seat-4",
		]);
		expect(
			fresh.public.seats.map((seat) => seat.stack + seat.handContribution)
		).toEqual([200, 200]);
		expect(fresh.public.seats.map((seat) => seat.stack)).toEqual([195, 190]);
		expect(fresh.public.dealerIndex).toBe(0);
		expect(fresh.public.smallBlindIndex).toBe(0);
		expect(fresh.public.bigBlindIndex).toBe(1);
		expect(fresh.public.handNumber).toBe(1);
		expect(fresh.public.street).toBe("preflop");
		expect(fresh.public.handStatus).toBe("playing");
		expect(fresh.public.currentBet).toBe(10);
		expect(fresh.public.lastFullRaiseIncrement).toBe(10);
		expect(fresh.public.actor).toBe(0);
		expect(fresh.public.board).toEqual([]);
		expect(fresh.public.settlement).toBeNull();
		expect(fresh.public.result).toBeNull();
		expect(fresh.private.pendingExpiryConnectedSeatIds).toBeNull();
		expect(fresh.private.nextCardIndex).toBe(4);
		expect(fresh.private.deck).toEqual(tieDeck(2)());
		expect(fresh.private.deck).not.toBe(state.private.deck);
		expect(fresh.private.holeCards).toEqual([cards("3c 5c"), cards("2c 4c")]);
		expect(fresh.public.matchId).toBe("new-match");
		expect(fresh.public.handId).toBe("new-hand");
		for (const seat of fresh.public.seats) {
			expect(seat.folded).toBe(false);
			expect(seat.allIn).toBe(false);
			expect(seat.inHand).toBe(true);
			expect(seat.actedThisRound).toBe(false);
			expect(seat.lastActedBet).toBeNull();
			expect(seat.raiseAllowed).toBe(true);
		}
		expect(fresh.public.matchId).not.toBe(state.public.matchId);
		expect(fresh.public.handId).not.toBe(state.public.handId);
		expect(chips(fresh)).toBe(400);
		expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
	});
	test("invalid or reused generated identifiers throw without changing the final result", () => {
		const state = finishFixture([400, 0]);
		for (const source of [
			() => "",
			() => state.public.matchId as string,
			() => "same-id",
		]) {
			pure(state, () =>
				expect(() =>
					rematch(state, "seat-0", "seat-0", connected(state), fullDeck, source)
				).toThrow()
			);
		}
	});
	test("rematch clears pending expiry even after abandonment", () => {
		const state = settled([200, 200]);
		const finished = advanceMatch(
			requestExpiryTermination(state, new Set()),
			fullDeck,
			ids()
		);
		const result = rematch(
			finished,
			"seat-0",
			"seat-0",
			connected(finished),
			fullDeck,
			(kind) => `rematch-${kind}`
		);
		assert.ok(result.ok);
		expect(result.state.private.pendingExpiryConnectedSeatIds).toBeNull();
		expect(result.state.public.result).toBeNull();
	});
});

function seeded(seed: number): Uint32Source {
	let value = seed;
	return () => {
		value = (value * 48_271) % 2_147_483_647;
		return Math.floor(((value - 1) * 2 ** 32) / 2_147_483_646);
	};
}
function randomAction(
	state: MatchState,
	rng: Uint32Source,
	callHeavy: boolean
): BettingAction {
	const descriptors = legalActions(state, state.public.actor as number).actions;
	assert.ok(descriptors.length > 0);
	const options =
		callHeavy && boundedIndex(20, rng) !== 0
			? descriptors.filter(
					(candidate) => candidate.type === "call" || candidate.type === "check"
				)
			: descriptors;
	const offered = options[boundedIndex(options.length, rng)];
	assert.ok(offered);
	if (offered.type === "bet" || offered.type === "raise") {
		const minimum = offered.minTotalTo as number;
		return {
			totalTo:
				minimum +
				boundedIndex((offered.maxTotalTo as number) - minimum + 1, rng),
			type: offered.type,
		};
	}
	return { type: offered.type };
}

describe("seeded complete matches and rematch-after-finish property", () => {
	for (const count of [2, 3, 4]) {
		test(`${count} seats: 240 complete random legal matches, <=10 hands and repeated rematches`, () => {
			const seed = 34_000 + count;
			const rng = seeded(seed);
			const deckSource = () => shuffleDeck(fullDeck(), rng);
			const newIds = ids();
			let state = startLifecycleMatch(roster(count), deckSource, newIds);
			let totalHands = 0;
			let busts = 0;
			let limits = 0;
			let expiries = 0;
			let abandoned = 0;
			const seenIds = new Set<string>();
			for (let iteration = 0; iteration < 240; iteration += 1) {
				const { matchId } = state.public;
				assert.ok(matchId && !seenIds.has(matchId));
				seenIds.add(matchId);
				let handCount = 0;
				const expires = iteration % 12 === 0;
				const expiryIds = new Set(
					state.public.seats
						.filter(() => boundedIndex(2, rng) === 0)
						.map((seat) => seat.id)
				);
				if (expires) {
					state = pure(state, () => requestExpiryTermination(state, expiryIds));
				}
				while (!state.public.result) {
					handCount += 1;
					assert.ok(
						handCount <= MAX_HANDS,
						`seed=${seed}, match=${iteration}: endless match`
					);
					const { handId } = state.public;
					assert.ok(handId && !seenIds.has(handId));
					seenIds.add(handId);
					assert.equal(state.public.handNumber, handCount);
					assert.equal(state.public.matchId, matchId);
					let turns = 0;
					while (state.public.handStatus === "playing") {
						turns += 1;
						assert.ok(
							turns <= 1000,
							`seed=${seed}, match=${iteration}: endless hand`
						);
						assert.equal(chips(state), count * 200);
						state = action(
							state,
							randomAction(state, rng, iteration % 3 === 0)
						);
						for (const seat of state.public.seats) {
							assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
						}
					}
					assert.equal(state.public.result, null);
					state = pure(state, () => settleHand(state));
					assert.equal(chips(state), count * 200);
					const before = state;
					state = pure(state, () =>
						advanceMatch(state, deckSource, newIds, expiryIds)
					);
					totalHands += 1;
					let reason: MatchResult["terminationReason"] | null = null;
					if (expires) {
						reason = expiryIds.size === 0 ? "abandoned" : "seat_expired";
					} else if (before.public.seats.some((seat) => seat.stack === 0)) {
						reason = "bust";
					} else if (handCount === MAX_HANDS) {
						reason = "hands_complete";
					}
					if (reason) {
						const eligible = before.public.seats.filter(
							(seat) => !expires || expiryIds.has(seat.id)
						);
						// Independent highest-stack oracle: no candidate is strictly richer.
						const winners = eligible
							.filter((seat) =>
								eligible.every((other) => other.stack <= seat.stack)
							)
							.map((seat) => seat.id);
						assert.deepEqual(state.public.result, {
							finalStacks: before.public.seats.map((seat) => ({
								seatId: seat.id,
								stack: seat.stack,
							})),
							terminationReason: reason,
							winnerSeatIds: winners,
						});
						assert.equal(state.public.handStatus, "settled");
						assert.equal(state.public.actor, null);
					} else {
						assert.equal(state.public.result, null);
						assert.equal(state.public.dealerIndex, handCount % count);
					}
				}
				assert.equal(chips(state), count * 200);
				assert.ok(state.public.handNumber <= MAX_HANDS);
				const reason = state.public.result.terminationReason;
				busts += reason === "bust" ? 1 : 0;
				limits += reason === "hands_complete" ? 1 : 0;
				expiries += reason === "seat_expired" ? 1 : 0;
				abandoned += reason === "abandoned" ? 1 : 0;
				const rejected = pure(state, () =>
					rematch(
						state,
						"seat-2",
						"seat-0",
						connected(state),
						deckSource,
						newIds
					)
				);
				assert.equal(rejected.ok, false);
				assert.equal(rejected.state, state);
				const restarted = pure(state, () =>
					rematch(
						state,
						"seat-0",
						"seat-0",
						connected(state),
						deckSource,
						newIds
					)
				);
				assert.ok(restarted.ok);
				({ state } = restarted);
				assert.equal(state.public.result, null);
				assert.equal(state.public.settlement, null);
				assert.equal(state.public.handNumber, 1);
				assert.equal(state.public.dealerIndex, 0);
				assert.ok(
					state.public.seats.every(
						(seat) => seat.stack + seat.handContribution === 200
					)
				);
				assert.equal(state.public.board.length, 0);
			}
			assert.ok(
				busts > 0 && limits > 0 && expiries > 0 && abandoned > 0,
				`busts=${busts}, limits=${limits}, expiries=${expiries}, abandoned=${abandoned}`
			);
			console.info(
				`lifecycle seed=${seed} matches=240 hands=${totalHands} busts=${busts} limits=${limits} expiries=${expiries} abandoned=${abandoned} rematches=240`
			);
		}, 120_000);
	}
});
