import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert/strict";
import { type BettingAction, legalActions } from "./betting";
import { cardCode, cards, fullDeck } from "./cards";
import {
	applyActionAt,
	expireTurn,
	TURN_MS,
	type TurnDeadline,
} from "./deadline";
import {
	advanceMatchAt,
	expireTurnAndAdvanceAt,
	type IdGenerator,
	MAX_HANDS,
	rematchAt,
	requestExpiryTermination,
	startLifecycleMatchAt,
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
function roster(count = 2) {
	return Array.from({ length: count }, (_, index) => ({ id: `s${index}` }));
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
	assert.equal(JSON.stringify(state), before, "transition mutated input");
	return output;
}
function liveTurn(state: MatchState): TurnDeadline {
	assert.equal(state.public.handStatus, "playing");
	assert.ok(state.public.turn);
	assert.equal(state.public.actor, state.public.turn.actorIndex);
	assert.equal(state.public.handNumber, state.public.turn.handNumber);
	assert.equal(state.public.street, state.public.turn.street);
	assert.ok(
		legalActions(state, state.public.turn.actorIndex).actions.length > 0
	);
	return state.public.turn;
}
function timedOrFinal(state: MatchState, total: number): void {
	assert.equal(chips(state), total);
	assert.ok(
		state.public.handNumber >= 1 && state.public.handNumber <= MAX_HANDS
	);
	assert.ok(state.public.matchId && state.public.handId);
	for (const seat of state.public.seats) {
		assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
		assert.ok(
			Number.isSafeInteger(seat.handContribution) && seat.handContribution >= 0
		);
	}
	if (state.public.result) {
		assert.equal(state.public.handStatus, "settled");
		assert.equal(state.public.actor, null);
		assert.equal(state.public.turn, null);
		assert.ok(state.public.settlement);
		assert.equal(
			state.public.result.finalStacks.reduce(
				(sum, seat) => sum + seat.stack,
				0
			),
			total
		);
	} else {
		liveTurn(state);
	}
}
function tieDeck() {
	const prefix = cards("2c 3c 4c 5c Th Jh Qh Kh Ah");
	const used = new Set(prefix.map(cardCode));
	return [...prefix, ...fullDeck().filter((card) => !used.has(cardCode(card)))];
}
/** A valid settled 400-chip boundary, with zero unresolved contributions. */
function settled(stacks: number[], handNumber = 1): MatchState {
	const state = startLifecycleMatchAt(roster(), 0, fullDeck, ids());
	state.public.actor = null;
	state.public.turn = null;
	state.public.handNumber = handNumber;
	state.public.handStatus = "showdown";
	state.public.street = "river";
	state.public.board = cards("Th Jh Qh Kh Ah");
	state.private.holeCards = [cards("2c 3c"), cards("4c 5c")];
	for (const [index, seat] of state.public.seats.entries()) {
		seat.stack = stacks[index] as number;
		seat.handContribution = 0;
		seat.streetContribution = 0;
		seat.allIn = seat.stack === 0;
		seat.raiseAllowed = false;
	}
	return settleHand(state);
}
function expected(
	stacks: number[],
	winnerSeatIds: string[],
	terminationReason: string
) {
	return {
		finalStacks: stacks.map((stack, index) => ({ seatId: `s${index}`, stack })),
		terminationReason,
		winnerSeatIds,
	};
}
const never = () => {
	throw new Error("no-op/final state called a source");
};

describe("timed lifecycle composition drain", () => {
	test("400-chip [397,3] boundary never strands its blind-only next hand", () => {
		const state = settled([397, 3]);
		let deals = 0;
		const dealtIds: string[] = [];
		const next = pure(state, () =>
			advanceMatchAt(
				state,
				500,
				() => {
					deals += 1;
					return fullDeck();
				},
				(kind) => {
					const id = `drained-${kind}-${dealtIds.length}`;
					dealtIds.push(id);
					return id;
				}
			)
		);
		timedOrFinal(next, 400);
		expect(next.public.matchId).toBe(state.public.matchId);
		expect(next.public.handId).not.toBe(state.public.handId);
		expect(deals).toBe(next.public.handNumber - 1);
		expect(dealtIds).toHaveLength(deals);
		expect(new Set(dealtIds).size).toBe(deals);
		expect(deals).toBeLessThanOrEqual(9);
		if (!next.public.result) {
			expect(liveTurn(next).deadlineAt).toBe(500 + TURN_MS);
		}
	});

	test("tied blind-only runouts drain exactly once per hand through hand ten", () => {
		const state = settled([397, 3]);
		let deals = 0;
		let generated = 0;
		const next = pure(state, () =>
			advanceMatchAt(
				state,
				1000,
				() => {
					deals += 1;
					return tieDeck();
				},
				(kind) => {
					generated += 1;
					return `${kind}-tie-${generated}`;
				}
			)
		);
		expect(next.public.handNumber).toBe(MAX_HANDS);
		expect(next.public.dealerIndex).toBe(1);
		expect(next.public.matchId).toBe(state.public.matchId);
		expect(next.public.handId).toBe("hand-tie-9");
		expect(next.public.result).toEqual(
			expected([397, 3], ["s0"], "hands_complete")
		);
		expect(next.public.settlement?.reason).toBe("showdown");
		expect(deals).toBe(9);
		expect(generated).toBe(9);
		timedOrFinal(next, 400);
		expect(pure(next, () => advanceMatchAt(next, 2000, never, never))).toBe(
			next
		);
	});

	test("timeout settlement composes into exactly one new hand with preserved match ID", () => {
		const state = startLifecycleMatchAt(roster(), 50, fullDeck, ids());
		const captured = liveTurn(state);
		const nowMs = captured.deadlineAt + 500;
		const expired = pure(state, () => expireTurn(state, captured, nowMs));
		expect(expired.expired).toBe(true);
		expect(expired.state.public.handStatus).toBe("settled");
		expect(expired.state.public.turn).toBeNull();
		const separate = advanceMatchAt(
			expired.state,
			nowMs,
			fullDeck,
			() => "next-hand"
		);
		let deals = 0;
		let generated = 0;
		const composed = pure(state, () =>
			expireTurnAndAdvanceAt(
				state,
				captured,
				nowMs,
				() => {
					deals += 1;
					return fullDeck();
				},
				() => {
					generated += 1;
					return "next-hand";
				}
			)
		);
		expect(composed).toEqual({ expired: true, state: separate });
		expect(deals).toBe(1);
		expect(generated).toBe(1);
		expect(composed.state.public.handNumber).toBe(2);
		expect(composed.state.public.matchId).toBe(state.public.matchId);
		expect(composed.state.public.handId).toBe("next-hand");
		expect(liveTurn(composed.state).deadlineAt).toBe(nowMs + TURN_MS);
		expect(liveTurn(composed.state).turnId).toBe(1);
		timedOrFinal(composed.state, 400);
		expect(
			expireTurnAndAdvanceAt(
				state,
				captured,
				captured.deadlineAt - 1,
				never,
				never
			).state
		).toBe(state);
		expect(
			expireTurnAndAdvanceAt(composed.state, captured, nowMs, never, never)
		).toEqual({ expired: false, state: composed.state });
		expect(advanceMatchAt(composed.state, nowMs + 300, never, never)).toBe(
			composed.state
		);
	});

	test("pending expiry preserves deadlines until settlement and uses latest connected IDs", () => {
		const original = startLifecycleMatchAt(roster(), 100, fullDeck, ids());
		const state = requestExpiryTermination(original, connected(original));
		expect(state.public).toBe(original.public);
		expect(liveTurn(state)).toBe(liveTurn(original));
		expect(advanceMatchAt(state, 200, fullDeck, ids())).toBe(state);
		const finished = pure(state, () =>
			expireTurnAndAdvanceAt(
				state,
				liveTurn(state),
				liveTurn(state).deadlineAt,
				never,
				never,
				new Set(["s0"])
			)
		);
		expect(finished.expired).toBe(true);
		expect(finished.state.public.result).toEqual(
			expected([195, 205], ["s0"], "seat_expired")
		);
		expect(finished.state.public.handId).toBe(state.public.handId);
		timedOrFinal(finished.state, 400);
		const abandoned = expireTurnAndAdvanceAt(
			state,
			liveTurn(state),
			liveTurn(state).deadlineAt,
			never,
			never,
			new Set()
		);
		expect(abandoned.state.public.result).toEqual(
			expected([195, 205], [], "abandoned")
		);
		timedOrFinal(abandoned.state, 400);
	});

	test("rematch gets distinct IDs and a fresh live deadline without a second deal", () => {
		const finished = advanceMatchAt(
			settled([200, 200], MAX_HANDS),
			500,
			fullDeck,
			ids()
		);
		const state = {
			...finished,
			public: { ...finished.public, roomCode: "ABC123" },
		};
		let deals = 0;
		const restarted = pure(state, () =>
			rematchAt(
				state,
				"s0",
				"s0",
				connected(state),
				2000,
				() => {
					deals += 1;
					return fullDeck();
				},
				(kind) => `rematch-${kind}`
			)
		);
		assert.ok(restarted.ok);
		expect(deals).toBe(1);
		expect(restarted.state.public.matchId).toBe("rematch-match");
		expect(restarted.state.public.handId).toBe("rematch-hand");
		expect(restarted.state.public.handNumber).toBe(1);
		expect(restarted.state.public.dealerIndex).toBe(0);
		expect(
			"roomCode" in restarted.state.public && restarted.state.public.roomCode
		).toBe("ABC123");
		expect(liveTurn(restarted.state).deadlineAt).toBe(2000 + TURN_MS);
		expect(liveTurn(restarted.state).turnId).toBe(1);
		timedOrFinal(restarted.state, 400);
		const rejected = rematchAt(
			state,
			"s1",
			"s0",
			connected(state),
			2000,
			never,
			never
		);
		expect(rejected.ok).toBe(false);
		expect(rejected.state).toBe(state);
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
	const offered = legalActions(state, liveTurn(state).actorIndex).actions;
	const options =
		callHeavy && boundedIndex(20, rng) !== 0
			? offered.filter(
					(candidate) => candidate.type === "call" || candidate.type === "check"
				)
			: offered;
	const action = options[boundedIndex(options.length, rng)];
	assert.ok(action);
	if (action.type === "bet" || action.type === "raise") {
		const minimum = action.minTotalTo as number;
		return {
			totalTo:
				minimum +
				boundedIndex((action.maxTotalTo as number) - minimum + 1, rng),
			type: action.type,
		};
	}
	return { type: action.type };
}

describe("seeded full timed matches", () => {
	for (const count of [2, 3, 4]) {
		test(`${count} seats: 120 matches driven only by timed APIs and an advancing fake clock`, () => {
			const seed = 34_200 + count;
			const rng = seeded(seed);
			const deckSource = () => shuffleDeck(fullDeck(), rng);
			const newIds = ids();
			let nowMs = 0;
			let actions = 0;
			let timeouts = 0;
			let hands = 0;
			let state = startLifecycleMatchAt(
				roster(count),
				nowMs,
				deckSource,
				newIds
			);
			for (let iteration = 0; iteration < 120; iteration += 1) {
				const { matchId } = state.public;
				let steps = 0;
				const expiryIds = new Set(
					state.public.seats
						.filter(() => boundedIndex(2, rng) === 0)
						.map((seat) => seat.id)
				);
				if (iteration % 12 === 0) {
					state = pure(state, () => requestExpiryTermination(state, expiryIds));
				}
				while (!state.public.result) {
					timedOrFinal(state, count * 200);
					steps += 1;
					assert.ok(
						steps <= 5000,
						`seed=${seed} match=${iteration}: endless match`
					);
					const captured = { ...liveTurn(state) };
					if (boundedIndex(4, rng) === 0) {
						nowMs = captured.deadlineAt + boundedIndex(4000, rng);
						const result = pure(state, () =>
							expireTurnAndAdvanceAt(
								state,
								captured,
								nowMs,
								deckSource,
								newIds,
								expiryIds
							)
						);
						assert.ok(result.expired);
						({ state } = result);
						timeouts += 1;
					} else {
						nowMs += 1 + boundedIndex(TURN_MS - 1, rng);
						assert.ok(nowMs < captured.deadlineAt);
						const result = pure(state, () =>
							applyActionAt(
								state,
								captured.actorIndex,
								randomAction(state, rng, iteration % 3 === 0),
								nowMs
							)
						);
						assert.ok(result.ok);
						state = pure(result.state, () =>
							advanceMatchAt(result.state, nowMs, deckSource, newIds, expiryIds)
						);
						actions += 1;
					}
					assert.equal(state.public.matchId, matchId);
					timedOrFinal(state, count * 200);
					if (!state.public.result) {
						assert.equal(liveTurn(state).deadlineAt, nowMs + TURN_MS);
					}
					const obsolete = pure(state, () =>
						expireTurnAndAdvanceAt(state, captured, nowMs, never, never)
					);
					assert.equal(obsolete.expired, false);
					assert.equal(obsolete.state, state);
				}
				hands += state.public.handNumber;
				const restarted = pure(state, () =>
					rematchAt(
						state,
						"s0",
						"s0",
						connected(state),
						nowMs,
						deckSource,
						newIds
					)
				);
				assert.ok(restarted.ok);
				({ state } = restarted);
				timedOrFinal(state, count * 200);
				assert.equal(liveTurn(state).deadlineAt, nowMs + TURN_MS);
			}
			assert.ok(actions > 0 && timeouts > 0);
			console.info(
				`timed lifecycle seed=${seed} matches=120 hands=${hands} actions=${actions} timeouts=${timeouts} rematches=120`
			);
		}, 120_000);
	}
});
