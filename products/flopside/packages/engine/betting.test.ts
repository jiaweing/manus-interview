import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert/strict";
import {
	applyAction,
	type BettingAction,
	legalActions,
	progressBetting,
} from "./betting";
import { fullDeck } from "./cards";
import { advanceStreet, startMatch, startNextHand } from "./dealing";
import { boundedIndex, shuffleDeck, type Uint32Source } from "./shuffle";
import type { MatchState, SeatState } from "./state";

const ACTION_TYPES = [
	"fold",
	"check",
	"call",
	"bet",
	"raise",
	"allin",
] as const;

function match(count = 4): MatchState {
	return startMatch(
		Array.from({ length: count }, (_, index) => ({ id: `s${index}` })),
		fullDeck
	);
}

function nextHand(stacks: number[]): MatchState {
	const settled = match(stacks.length);
	for (const [index, stack] of stacks.entries()) {
		Object.assign(seatAt(settled, index), {
			handContribution: 0,
			stack,
			streetContribution: 0,
		});
	}
	return startNextHand(settled, fullDeck);
}

function seatAt(state: MatchState, index: number): SeatState {
	const seat = state.public.seats[index];
	if (!seat) {
		throw new Error("Missing fixture seat");
	}
	return seat;
}

function chips(state: MatchState): number {
	return state.public.seats.reduce(
		(sum, seat) => sum + seat.stack + seat.handContribution,
		0
	);
}

function types(state: MatchState, index = state.public.actor as number) {
	return legalActions(state, index).actions.map((action) => action.type);
}

function play(
	state: MatchState,
	action: BettingAction,
	index = state.public.actor as number
): MatchState {
	const before = JSON.stringify(state);
	const result = applyAction(state, index, action);
	expect(JSON.stringify(state)).toBe(before);
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	expect(chips(result.state)).toBe(chips(state));
	expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
	return result.state;
}

function rejected(
	state: MatchState,
	action: BettingAction,
	index = state.public.actor as number,
	code: "ILLEGAL_ACTION" | "NOT_YOUR_TURN" = "ILLEGAL_ACTION"
) {
	const before = JSON.stringify(state);
	const result = applyAction(state, index, action);
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("Unexpected accepted action");
	}
	expect(result.error.code).toBe(code);
	expect(result.state).toBe(state);
	expect(JSON.stringify(result.state)).toBe(before);
	expect(JSON.stringify(state)).toBe(before);
}

function flop(count = 4): MatchState {
	let state = match(count);
	while (state.public.street === "preflop") {
		state = play(state, {
			type: types(state).includes("call") ? "call" : "check",
		});
	}
	return state;
}

function seeded(seed: number): Uint32Source {
	let value = seed;
	return () => {
		value = (value * 1_664_525 + 1_013_904_223) % 2 ** 32;
		return value;
	};
}

function deepFreeze(state: MatchState) {
	for (const seat of state.public.seats) {
		Object.freeze(seat);
	}
	for (const card of state.private.deck) {
		Object.freeze(card);
	}
	for (const hole of state.private.holeCards) {
		Object.freeze(hole);
	}
	Object.freeze(state.public.seats);
	Object.freeze(state.public.board);
	Object.freeze(state.public.blinds);
	Object.freeze(state.private.deck);
	Object.freeze(state.private.holeCards);
	Object.freeze(state.public);
	Object.freeze(state.private);
	Object.freeze(state);
}

/** Enumerate EVERY integer wager represented by a HUD descriptor. */
function offeredActions(state: MatchState, index: number): BettingAction[] {
	const actions: BettingAction[] = [];
	for (const offered of legalActions(state, index).actions) {
		if (offered.type === "bet" || offered.type === "raise") {
			for (
				let totalTo = offered.minTotalTo as number;
				totalTo <= (offered.maxTotalTo as number);
				totalTo += 1
			) {
				actions.push({ totalTo, type: offered.type });
			}
		} else {
			actions.push({ type: offered.type });
			if (offered.type === "allin") {
				actions.push({ totalTo: offered.maxTotalTo, type: "allin" });
			}
		}
	}
	return actions;
}

function assertClosure(state: MatchState, index: number) {
	const before = JSON.stringify(state);
	deepFreeze(state);
	const offered = legalActions(state, index);
	for (const action of offeredActions(state, index)) {
		const result = applyAction(state, index, action);
		assert.equal(result.ok, true, JSON.stringify(action));
		assert.equal(chips(result.state), chips(state));
	}
	const illegal: BettingAction[] = [];
	for (const type of ACTION_TYPES) {
		const descriptor = offered.actions.find((action) => action.type === type);
		if (!descriptor) {
			illegal.push({ totalTo: 10, type });
		} else if (descriptor.minTotalTo === undefined) {
			illegal.push({ totalTo: 0, type });
		} else {
			illegal.push(
				{ totalTo: descriptor.minTotalTo - 1, type },
				{ totalTo: (descriptor.maxTotalTo as number) + 1, type },
				{ totalTo: descriptor.minTotalTo + 0.5, type }
			);
		}
	}
	for (const action of illegal) {
		const result = applyAction(state, index, action);
		assert.equal(result.ok, false, JSON.stringify(action));
		assert.equal(result.state, state);
		assert.equal(JSON.stringify(state), before);
	}
	const wrongTurn = applyAction(
		state,
		(index + 1) % state.public.seats.length,
		{
			type: "fold",
		}
	);
	assert.equal(wrongTurn.ok, false);
	if (!wrongTurn.ok) {
		assert.equal(wrongTurn.error.code, "NOT_YOUR_TURN");
	}
	assert.equal(JSON.stringify(state), before);
}

/** Rule oracle, not just descriptor/reducer consistency: a covered sole seat never acts. */
function assertBettingDecision(state: MatchState) {
	const live = state.public.seats.filter((seat) => seat.inHand && !seat.folded);
	const actualBet = Math.max(...live.map((seat) => seat.streetContribution));
	const funded = live.filter((seat) => !seat.allIn && seat.stack > 0);
	if (state.public.handStatus !== "playing") {
		assert.equal(state.public.actor, null);
		for (let index = 0; index < state.public.seats.length; index += 1) {
			assert.equal(legalActions(state, index).actions.length, 0);
		}
		return;
	}
	assert.ok(live.length > 1);
	assert.ok(funded.length > 0);
	assert.notEqual(state.public.actor, null);
	const index = state.public.actor as number;
	const actor = seatAt(state, index);
	assert.ok(funded.includes(actor));
	const legal = legalActions(state, index);
	if (funded.length === 1) {
		const outstanding = Math.max(0, actualBet - actor.streetContribution);
		assert.ok(outstanding > 0, "A covered sole funded contender must run out");
		assert.equal(legal.callAmount, Math.min(outstanding, actor.stack));
		assert.equal(legal.canRaise, false);
		assert.equal(
			legal.actions.some((action) => action.type === "allin"),
			actor.stack <= outstanding
		);
	} else {
		assert.ok(!actor.actedThisRound || actor.streetContribution < actualBet);
		assert.equal(
			legal.callAmount,
			Math.min(
				actor.stack,
				Math.max(0, state.public.currentBet - actor.streetContribution)
			)
		);
	}
}

describe("total-to wagers and authoritative legality", () => {
	test("contribution 10 to 30 charges 20, never 30 more", () => {
		let state = match(3);
		state = play(state, { totalTo: 20, type: "raise" });
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(seatAt(state, 2).streetContribution).toBe(10);
		state = play(state, { totalTo: 30, type: "raise" });
		expect(seatAt(state, 2).stack).toBe(170);
		expect(seatAt(state, 2).streetContribution).toBe(30);
		expect(seatAt(state, 2).handContribution).toBe(30);
		expect(state.public.currentBet).toBe(30);
	});

	test("calls pay only outstanding; short calls consume remaining stack", () => {
		let state = match(3);
		state = play(state, { totalTo: 30, type: "raise" });
		expect(legalActions(state, 1).callAmount).toBe(25);
		state = play(state, { type: "call" });
		expect(seatAt(state, 1).stack).toBe(170);
		seatAt(state, 2).stack = 7;
		expect(legalActions(state, 2).callAmount).toBe(7);
		state = play(state, { type: "call" });
		expect(seatAt(state, 2).stack).toBe(0);
		expect(seatAt(state, 2).handContribution).toBe(17);
		expect(seatAt(state, 2).allIn).toBe(true);
		expect(state.public.street).toBe("flop");
		expect(types(state, 2)).toEqual([]);
	});

	test("all-in is a short call when the remaining stack cannot match", () => {
		let state = match(3);
		state = play(state, { totalTo: 50, type: "raise" });
		seatAt(state, 1).stack = 9;
		state = play(state, { type: "allin" });
		expect(seatAt(state, 1).streetContribution).toBe(14);
		expect(seatAt(state, 1).stack).toBe(0);
		expect(state.public.currentBet).toBe(50);
		expect(state.public.actor).toBe(2);
	});

	test("invalid action and amount boundaries are byte-equal rejections", () => {
		const state = match();
		for (const action of [
			{ type: "check" },
			{ totalTo: 10, type: "bet" },
			{ totalTo: 19, type: "raise" },
			{ totalTo: 201, type: "raise" },
			{ totalTo: 20.5, type: "raise" },
			{ totalTo: Number.NaN, type: "raise" },
			{ totalTo: Number.POSITIVE_INFINITY, type: "raise" },
			{ totalTo: Number.MAX_SAFE_INTEGER + 1, type: "raise" },
			{ totalTo: -10, type: "raise" },
			{ type: "raise" },
			{ totalTo: 199, type: "allin" },
			{ totalTo: 0, type: "call" },
			{ totalTo: 0, type: "fold" },
			{ type: "unknown" },
		] as BettingAction[]) {
			rejected(state, action);
		}
		for (const index of [0, 1, 2, -1, 4, 3.5]) {
			rejected(state, { type: "fold" }, index, "NOT_YOUR_TURN");
		}
		const postflop = flop();
		rejected(postflop, { totalTo: 9, type: "bet" });
		rejected(postflop, { type: "call" });
		rejected(postflop, { totalTo: 0, type: "check" });
		rejected(postflop, { totalTo: 10, type: "raise" });
	});

	test("a sub-10 opening wager is allowed only for an actual short all-in", () => {
		let state = flop();
		seatAt(state, 1).stack = 6;
		expect(legalActions(state, 1)).toEqual({
			actions: [
				{ type: "fold" },
				{ type: "check" },
				{ maxTotalTo: 6, minTotalTo: 6, type: "bet" },
				{ maxTotalTo: 6, minTotalTo: 6, type: "allin" },
			],
			callAmount: 0,
			canRaise: true,
			maxTotalTo: 6,
			minTotalTo: 6,
		});
		rejected(state, { totalTo: 5, type: "bet" });
		const explicit = play(state, { totalTo: 6, type: "bet" });
		state = play(state, { type: "allin" });
		expect(state).toEqual(explicit);
		expect(state.public.currentBet).toBe(6);
		expect(state.public.lastFullRaiseIncrement).toBe(10);
		expect(seatAt(state, 1).allIn).toBe(true);
	});

	test("full raise 10 to 30 makes the next minimum 50", () => {
		let state = flop();
		state = play(state, { totalTo: 10, type: "bet" });
		expect(legalActions(state, 2).minTotalTo).toBe(20);
		state = play(state, { totalTo: 30, type: "raise" });
		expect(state.public.lastFullRaiseIncrement).toBe(20);
		expect(legalActions(state, 3).minTotalTo).toBe(50);
		rejected(state, { totalTo: 49, type: "raise" });
		state = play(state, { totalTo: 50, type: "raise" });
		expect(legalActions(state, 0).minTotalTo).toBe(70);
		expect(seatAt(state, 1).actedThisRound).toBe(false);
		expect(seatAt(state, 1).raiseAllowed).toBe(true);
	});

	test("short raise to 40 leaves a prior actor at 30 unable to raise", () => {
		let state = flop();
		seatAt(state, 0).stack = 40;
		state = play(state, { totalTo: 10, type: "bet" });
		state = play(state, { totalTo: 30, type: "raise" });
		state = play(state, { type: "call" });
		state = play(state, { totalTo: 40, type: "raise" });
		expect(state.public.lastFullRaiseIncrement).toBe(20);
		expect(seatAt(state, 2).raiseAllowed).toBe(false);
		expect(seatAt(state, 3).raiseAllowed).toBe(false);
		// Seat 1 last acted at 10: the increase to 40 DOES reopen that seat.
		expect(seatAt(state, 1).raiseAllowed).toBe(true);
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(legalActions(state, 2)).toEqual({
			actions: [{ type: "fold" }, { type: "call" }],
			callAmount: 10,
			canRaise: false,
			maxTotalTo: null,
			minTotalTo: null,
		});
		rejected(state, { totalTo: 60, type: "raise" });
		rejected(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(types(state)).toEqual(["fold", "call"]);
		state = play(state, { type: "call" });
		expect(state.public.street).toBe("turn");
	});

	test("a prior actor without raise rights may still make a short all-in call", () => {
		let state = flop();
		seatAt(state, 0).stack = 40;
		state = play(state, { totalTo: 10, type: "bet" });
		state = play(state, { totalTo: 30, type: "raise" });
		seatAt(state, 2).stack = 8;
		state = play(state, { type: "call" });
		state = play(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(seatAt(state, 2).raiseAllowed).toBe(false);
		expect(legalActions(state, 2).callAmount).toBe(8);
		expect(types(state)).toEqual(["fold", "call", "allin"]);
		state = play(state, { totalTo: 38, type: "allin" });
		expect(state.public.currentBet).toBe(40);
		expect(seatAt(state, 2).streetContribution).toBe(38);
		expect(seatAt(state, 2).allIn).toBe(true);
	});

	test("not-yet-acted seats retain raise rights after a short all-in", () => {
		let state = flop();
		seatAt(state, 3).stack = 40;
		state = play(state, { totalTo: 10, type: "bet" });
		state = play(state, { totalTo: 30, type: "raise" });
		state = play(state, { type: "allin" });
		expect(state.public.actor).toBe(0);
		expect(seatAt(state, 0).actedThisRound).toBe(false);
		expect(seatAt(state, 0).raiseAllowed).toBe(true);
		expect(types(state)).toEqual(["fold", "call", "raise", "allin"]);
		expect(legalActions(state, 0).minTotalTo).toBe(60);
		state = play(state, { totalTo: 60, type: "raise" });
		expect(seatAt(state, 2).raiseAllowed).toBe(true);
	});

	test("cumulative short all-ins to 40 then 50 reopen actor last at 30", () => {
		let state = flop();
		seatAt(state, 3).stack = 40;
		seatAt(state, 0).stack = 50;
		state = play(state, { totalTo: 10, type: "bet" });
		state = play(state, { totalTo: 30, type: "raise" });
		state = play(state, { type: "allin" });
		expect(seatAt(state, 2).lastActedBet).toBe(30);
		expect(seatAt(state, 2).raiseAllowed).toBe(false);
		state = play(state, { type: "allin" });
		expect(state.public.currentBet).toBe(50);
		expect(state.public.lastFullRaiseIncrement).toBe(20);
		expect(seatAt(state, 2).raiseAllowed).toBe(true);
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(types(state)).toEqual(["fold", "call", "raise", "allin"]);
		expect(legalActions(state, 2).minTotalTo).toBe(70);
		state = play(state, { totalTo: 70, type: "raise" });
		expect(seatAt(state, 2).streetContribution).toBe(70);
	});

	test("calling at an intermediate short-raise level resets the cumulative baseline", () => {
		let state = flop();
		seatAt(state, 3).stack = 40;
		seatAt(state, 1).stack = 50;
		state = play(state, { totalTo: 10, type: "bet" });
		state = play(state, { totalTo: 30, type: "raise" });
		state = play(state, { type: "allin" });
		state = play(state, { type: "call" });
		state = play(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(0);
		expect(seatAt(state, 0).lastActedBet).toBe(40);
		expect(seatAt(state, 0).raiseAllowed).toBe(false);
		expect(types(state)).toEqual(["fold", "call"]);
	});
});

describe("turn order, round completion and unsettled hand endings", () => {
	for (const count of [2, 3, 4]) {
		test(`${count} seats: BB option and full rounds through river`, () => {
			let state = match(count);
			const preflop: number[] = [];
			for (let turn = 0; turn < count; turn += 1) {
				const actor = state.public.actor as number;
				preflop.push(actor);
				expect(state.public.street).toBe("preflop");
				if (turn === count - 1) {
					expect(actor).toBe(state.public.bigBlindIndex);
					expect(types(state)).toEqual(["fold", "check", "raise", "allin"]);
				} else {
					expect(types(state)).toEqual(["fold", "call", "raise", "allin"]);
				}
				state = play(state, { type: turn === count - 1 ? "check" : "call" });
			}
			const first = count === 4 ? 3 : 0;
			expect(preflop).toEqual(
				Array.from({ length: count }, (_, offset) => (first + offset) % count)
			);
			for (const street of ["flop", "turn", "river"] as const) {
				for (let turn = 0; turn < count; turn += 1) {
					expect(state.public.street).toBe(street);
					expect(state.public.actor).toBe((1 + turn) % count);
					expect(types(state)).toEqual(["fold", "check", "bet", "allin"]);
					state = play(state, { type: "check" });
				}
			}
			expect(state.public.actor).toBeNull();
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.board).toHaveLength(5);
			expect(chips(state)).toBe(count * 200);
			for (const seat of state.public.seats) {
				expect(seat.handContribution).toBe(10);
			}
		});

		test(`${count} seats: actual wagers on every street reset round metadata`, () => {
			let state = flop(count);
			for (const street of ["flop", "turn", "river"] as const) {
				expect(state.public.street).toBe(street);
				expect(state.public.currentBet).toBe(0);
				expect(state.public.lastFullRaiseIncrement).toBe(10);
				state = play(state, { totalTo: 10, type: "bet" });
				state = play(state, { totalTo: 30, type: "raise" });
				for (let call = 0; call < count - 1; call += 1) {
					state = play(state, { type: "call" });
				}
			}
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.seats.map((seat) => seat.handContribution)).toEqual(
				new Array<number>(count).fill(100)
			);
			expect(state.public.seats.map((seat) => seat.stack)).toEqual(
				new Array<number>(count).fill(100)
			);
		});
	}

	test("BB can raise its option and action returns to prior callers", () => {
		let state = match(2);
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(1);
		state = play(state, { totalTo: 30, type: "raise" });
		expect(state.public.actor).toBe(0);
		expect(state.public.street).toBe("preflop");
		expect(legalActions(state, 0).callAmount).toBe(20);
		state = play(state, { type: "call" });
		expect(state.public.street).toBe("flop");
		expect(state.public.actor).toBe(1);
	});

	test("folded and all-in seats never receive controls or turns", () => {
		let state = match();
		state = play(state, { type: "fold" });
		state = play(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(types(state, 0)).toEqual([]);
		expect(types(state, 1)).toEqual([]);
		expect(types(state, 3)).toEqual([]);
		rejected(state, { type: "check" }, 0, "NOT_YOUR_TURN");
		rejected(state, { type: "fold" }, 3, "NOT_YOUR_TURN");
		state = play(state, { type: "call" });
		expect(state.public.handStatus).toBe("showdown");
		expect(state.public.actor).toBeNull();
	});

	test("one non-folded contender ends the hand without dealing or awarding", () => {
		let state = match();
		state = play(state, { type: "fold" });
		state = play(state, { type: "fold" });
		state = play(state, { type: "fold" });
		expect(state.public.handStatus).toBe("folded");
		expect(state.public.actor).toBeNull();
		expect(state.public.board).toEqual([]);
		expect(state.public.seats.map((seat) => seat.handContribution)).toEqual([
			0, 5, 10, 0,
		]);
		expect(seatAt(state, 2).stack).toBe(190);
		expect(progressBetting(state)).toBe(state);
		for (let index = 0; index < 4; index += 1) {
			expect(types(state, index)).toEqual([]);
			rejected(state, { type: "fold" }, index, "NOT_YOUR_TURN");
		}
	});

	test("a sole funded player must respond, then runout has no dry-side-pot wager", () => {
		let state = match(2);
		seatAt(state, 0).stack = 35;
		state = play(state, { type: "allin" });
		expect(state.public.actor).toBe(1);
		expect(state.public.board).toEqual([]);
		expect(types(state)).toEqual(["fold", "call"]);
		rejected(state, { totalTo: 60, type: "raise" });
		rejected(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(state.public.handStatus).toBe("showdown");
		expect(state.public.street).toBe("river");
		expect(state.public.board).toHaveLength(5);
		expect(state.public.actor).toBeNull();
		expect(state.public.seats.map((seat) => seat.handContribution)).toEqual([
			40, 40,
		]);
		expect(seatAt(state, 1).stack).toBe(160);
	});

	for (const bigBlind of [1, 3]) {
		test(`heads-up BB ${bigBlind}/SB 5 is already covered: no decision, immediate runout`, () => {
			const initial = nextHand([bigBlind, 400 - bigBlind]);
			expect(initial.public.bigBlindIndex).toBe(0);
			expect(initial.public.currentBet).toBe(10);
			expect(
				initial.public.seats.map((seat) => seat.streetContribution)
			).toEqual([bigBlind, 5]);
			// Even an unnormalized hand cannot advertise/accept a phantom fold.
			expect(types(initial, 1)).toEqual([]);
			rejected(initial, { type: "fold" }, 1);
			const before = JSON.stringify(initial);
			const state = progressBetting(initial);
			expect(JSON.stringify(initial)).toBe(before);
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.street).toBe("river");
			expect(state.public.actor).toBeNull();
			expect(state.public.board).toHaveLength(5);
			expect(state.public.seats.map((seat) => seat.handContribution)).toEqual([
				bigBlind,
				5,
			]);
			expect(seatAt(state, 1).stack).toBe(395 - bigBlind);
			expect(chips(state)).toBe(400);
			for (const index of [0, 1]) {
				expect(legalActions(state, index)).toEqual({
					actions: [],
					callAmount: 0,
					canRaise: false,
					maxTotalTo: null,
					minTotalTo: null,
				});
				for (const type of ACTION_TYPES) {
					rejected(state, { type }, index, "NOT_YOUR_TURN");
				}
			}
		});
	}

	for (const bigBlind of [7, 10]) {
		test(`heads-up all-in BB ${bigBlind}/SB 5 calls only ${bigBlind - 5} actual chips`, () => {
			let state = progressBetting(nextHand([bigBlind, 400 - bigBlind]));
			expect(state.public.actor).toBe(1);
			expect(state.public.handStatus).toBe("playing");
			expect(legalActions(state, 1)).toEqual({
				actions: [{ type: "fold" }, { type: "call" }],
				callAmount: bigBlind - 5,
				canRaise: false,
				maxTotalTo: null,
				minTotalTo: null,
			});
			rejected(state, { type: "allin" });
			rejected(state, { totalTo: 20, type: "raise" });
			state = play(state, { type: "call" });
			expect(state.public.seats.map((seat) => seat.handContribution)).toEqual([
				bigBlind,
				bigBlind,
			]);
			expect(seatAt(state, 1).stack).toBe(400 - 2 * bigBlind);
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.street).toBe("river");
			expect(state.public.actor).toBeNull();
		});
	}

	test("BB 7/SB 5 offers all-in only for an actual short or exact call, never nominal excess", () => {
		for (const smallBlindStack of [6, 7, 9]) {
			let state = progressBetting(nextHand([7, smallBlindStack]));
			expect(legalActions(state, 1).callAmount).toBe(
				Math.min(2, smallBlindStack - 5)
			);
			expect(types(state)).toEqual(
				smallBlindStack <= 7 ? ["fold", "call", "allin"] : ["fold", "call"]
			);
			if (smallBlindStack > 7) {
				rejected(state, { type: "allin" });
			}
			state = play(state, { type: smallBlindStack <= 7 ? "allin" : "call" });
			expect(seatAt(state, 1).handContribution).toBe(
				Math.min(7, smallBlindStack)
			);
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.actor).toBeNull();
		}
	});

	for (const count of [3, 4]) {
		test(`${count} seats: covered SB runs out after other funded seats fold against BB 3`, () => {
			const stacks = count === 3 ? [3, 200, 397] : [200, 200, 397, 3];
			let state = progressBetting(nextHand(stacks));
			expect(state.public.bigBlindIndex).toBe(count === 3 ? 0 : 3);
			expect(state.public.smallBlindIndex).toBe(2);
			// Two or more funded contenders still use the nominal multiway bring-in.
			expect(legalActions(state, state.public.actor as number).callAmount).toBe(
				10
			);
			for (let fold = 0; fold < count - 2; fold += 1) {
				state = play(state, { type: "fold" });
			}
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.street).toBe("river");
			expect(state.public.actor).toBeNull();
			expect(seatAt(state, 2).handContribution).toBe(5);
			expect(seatAt(state, 2).stack).toBe(392);
			expect(types(state, 2)).toEqual([]);
			rejected(state, { type: "fold" }, 2, "NOT_YOUR_TURN");
		});

		test(`${count} seats: BB 7 plus a shorter all-in leaves SB 5 owing only 2`, () => {
			const stacks = count === 3 ? [7, 1, 592] : [1, 200, 592, 7];
			let state = progressBetting(nextHand(stacks));
			state = play(state, { type: "allin" });
			if (count === 4) {
				state = play(state, { type: "fold" });
			}
			expect(state.public.actor).toBe(2);
			expect(legalActions(state, 2).callAmount).toBe(2);
			expect(types(state)).toEqual(["fold", "call"]);
			state = play(state, { type: "call" });
			expect(state.public.handStatus).toBe("showdown");
			expect(state.public.actor).toBeNull();
			expect(seatAt(state, 2).handContribution).toBe(7);
			expect(seatAt(state, 2).stack).toBe(585);
		});
	}

	test("multiway BB 3 retains nominal bring-in and funded SB's voluntary option", () => {
		let state = progressBetting(nextHand([3, 200, 397]));
		state = play(state, { type: "call" });
		expect(state.public.actor).toBe(2);
		expect(legalActions(state, 2).callAmount).toBe(5);
		expect(legalActions(state, 2).minTotalTo).toBe(20);
		state = play(state, { type: "call" });
		expect(state.public.handStatus).toBe("playing");
		expect(state.public.street).toBe("flop");
		expect(state.public.actor).toBe(2);
	});

	test("multiway actor selection skips an already-acted covered funded seat", () => {
		const initial = nextHand([3, 200, 397]);
		Object.assign(seatAt(initial, 2), {
			actedThisRound: true,
			handContribution: 10,
			lastActedBet: 10,
			stack: 387,
			streetContribution: 10,
		});
		initial.public.actor = 2;
		expect(types(initial, 2)).toEqual([]);
		rejected(initial, { type: "fold" }, 2);
		for (const afterIndex of [undefined, 1]) {
			const state = progressBetting(initial, afterIndex);
			expect(state.public.actor).toBe(1);
			expect(legalActions(state, 1).callAmount).toBe(10);
			expect(types(state, 2)).toEqual([]);
			const flopState = play(state, { type: "call" });
			expect(flopState.public.street).toBe("flop");
			expect(flopState.public.actor).toBe(2);
		}
	});

	test("all-in runout retains unmatched contributions for #32 refunds", () => {
		let state = match(2);
		seatAt(state, 1).stack = 15;
		const initial = chips(state);
		state = play(state, { type: "allin" });
		state = play(state, { type: "call" });
		expect(state.public.handStatus).toBe("showdown");
		expect(state.public.board).toHaveLength(5);
		expect(state.public.actor).toBeNull();
		expect(state.public.seats.map((seat) => seat.handContribution)).toEqual([
			200, 25,
		]);
		expect(chips(state)).toBe(initial);
	});

	test("normalization resolves blind-only all-ins and preserves an initial live actor", () => {
		const initial = match(2);
		expect(progressBetting(initial).public.actor).toBe(0);
		seatAt(initial, 0).stack = 7;
		seatAt(initial, 1).stack = 3;
		const short = startNextHand(initial, fullDeck);
		expect(short.public.actor).toBeNull();
		const before = JSON.stringify(short);
		const runout = progressBetting(short);
		expect(JSON.stringify(short)).toBe(before);
		expect(runout.public.board).toHaveLength(5);
		expect(runout.public.handStatus).toBe("showdown");
		expect(chips(runout)).toBe(10);
		expect(runout.public.seats.map((seat) => seat.handContribution)).toEqual([
			7, 3,
		]);
	});

	test("blinds do not count as voluntary actions; street resets restore rights", () => {
		const initial = match();
		for (const seat of initial.public.seats) {
			expect(seat.actedThisRound).toBe(false);
			expect(seat.lastActedBet).toBeNull();
			expect(seat.raiseAllowed).toBe(true);
		}
		const postflop = advanceStreet(initial);
		expect(postflop.public.currentBet).toBe(0);
		expect(postflop.public.lastFullRaiseIncrement).toBe(10);
		expect(postflop.public.handStatus).toBe("playing");
	});
});

describe("seeded property play", () => {
	for (const count of [2, 3, 4]) {
		test(`${count} seats: 1500 random-stack hands, short-blind rule oracle and exhaustive wagers`, () => {
			const rng = seeded(31_000 + count);
			let turns = 0;
			let shortBlindHands = 0;
			let coveredRunouts = 0;
			for (let hand = 0; hand < 1500; hand += 1) {
				const initial = match(count);
				// Mix broad stacks, short blinds with funded opponents, and all-short tables.
				const bigBlindIndex = count === 4 ? 3 : 0;
				const smallBlindIndex = count === 2 ? 1 : 2;
				for (const [index, seat] of initial.public.seats.entries()) {
					let range = hand % 3 === 2 ? 10 : 200;
					if (hand % 3 === 1 && index === bigBlindIndex) {
						range = 10;
					} else if (hand % 3 === 1 && index === smallBlindIndex) {
						range = 15;
					}
					seat.stack = 1 + boundedIndex(range, rng);
					seat.handContribution = 0;
					seat.streetContribution = 0;
				}
				const dealt = startNextHand(initial, () =>
					shuffleDeck(fullDeck(), rng)
				);
				if (
					seatAt(dealt, bigBlindIndex).streetContribution < 10 ||
					seatAt(dealt, smallBlindIndex).streetContribution < 5
				) {
					shortBlindHands += 1;
				}
				const funded = dealt.public.seats.filter((seat) => !seat.allIn);
				const actualBet = Math.max(
					...dealt.public.seats.map((seat) => seat.streetContribution)
				);
				let state = progressBetting(dealt);
				if (
					funded.length === 0 ||
					(funded.length === 1 &&
						(funded[0] as SeatState).streetContribution >= actualBet)
				) {
					assert.equal(state.public.handStatus, "showdown");
					assert.equal(state.public.street, "river");
					coveredRunouts += 1;
				}
				assertBettingDecision(state);
				const total = chips(state);
				let steps = 0;
				while (state.public.handStatus === "playing") {
					assert.ok(steps < 1000, `Loop at ${count} seats, hand ${hand}`);
					const index = state.public.actor;
					assert.notEqual(index, null);
					const actor = index as number;
					assertClosure(state, actor);
					for (let other = 0; other < count; other += 1) {
						if (other !== actor) {
							assert.equal(legalActions(state, other).actions.length, 0);
						}
					}
					const options = offeredActions(state, actor);
					const action = options[
						boundedIndex(options.length, rng)
					] as BettingAction;
					const result = applyAction(state, actor, action);
					assert.equal(result.ok, true);
					({ state } = result);
					assert.equal(chips(state), total);
					assertBettingDecision(state);
					for (const seat of state.public.seats) {
						assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
						assert.ok(Number.isSafeInteger(seat.handContribution));
						assert.ok(seat.handContribution >= seat.streetContribution);
						assert.equal(
							seat.allIn,
							seat.inHand && !seat.folded && seat.stack === 0
						);
					}
					steps += 1;
					turns += 1;
				}
				assert.equal(state.public.actor, null);
				assert.equal(
					JSON.stringify(progressBetting(state)),
					JSON.stringify(state)
				);
				if (state.public.handStatus === "showdown") {
					assert.equal(state.public.board.length, 5);
					if (
						state.public.seats.filter(
							(seat) => seat.inHand && !seat.folded && !seat.allIn
						).length <= 1
					) {
						coveredRunouts += 1;
					}
				} else {
					assert.equal(
						state.public.seats.filter((seat) => seat.inHand && !seat.folded)
							.length,
						1
					);
				}
			}
			assert.ok(turns > 1500);
			assert.ok(shortBlindHands > 500);
			assert.ok(coveredRunouts > 0);
		}, 120_000);
	}
});
