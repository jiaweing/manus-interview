import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert/strict";
import { type BettingAction, legalActions } from "./betting";
import { fullDeck } from "./cards";
import {
	advanceStreetAt,
	applyActionAt,
	assignDeadline,
	expireTurn,
	progressBettingAt,
	startMatchAt,
	startNextHandAt,
	TURN_MS,
	type TurnDeadline,
} from "./deadline";
import { startMatch } from "./dealing";
import { boundedIndex, shuffleDeck, type Uint32Source } from "./shuffle";
import type { MatchState } from "./state";

function fakeClock(nowMs = 0) {
	return { nowMs };
}

function match(count = 2, nowMs = 0): MatchState {
	return startMatchAt(
		Array.from({ length: count }, (_, index) => ({ id: `s${index}` })),
		nowMs,
		fullDeck
	);
}

function turn(state: MatchState): TurnDeadline {
	const current = state.public.turn;
	assert.ok(current);
	return current;
}

function chips(state: MatchState): number {
	return state.public.seats.reduce(
		(sum, seat) => sum + seat.stack + seat.handContribution,
		0
	);
}

function play(state: MatchState, action: BettingAction, nowMs: number) {
	const before = JSON.stringify(state);
	const result = applyActionAt(state, turn(state).actorIndex, action, nowMs);
	expect(result.ok).toBe(true);
	expect(JSON.stringify(state)).toBe(before);
	expect(chips(result.state)).toBe(chips(state));
	return result.state;
}

function freezeTree(value: unknown): void {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			freezeTree(child);
		}
		Object.freeze(value);
	}
}

function seeded(seed: number): Uint32Source {
	let value = seed;
	return () => {
		value = (value * 1_664_525 + 1_013_904_223) % 2 ** 32;
		return value;
	};
}

function shortHand(stacks: number[], nowMs = 0): MatchState {
	// A fixture boundary may supply unequal settled stacks, never an active wager.
	let state = match(stacks.length);
	while (state.public.handStatus === "playing") {
		({ state } = expireTurn(state, turn(state), turn(state).deadlineAt));
	}
	state = structuredClone(state);
	for (const [index, seat] of state.public.seats.entries()) {
		seat.stack = stacks[index] as number;
	}
	return startNextHandAt(state, nowMs, fullDeck);
}

describe("authoritative injected-clock deadlines", () => {
	test("11999ms is early; exactly 12000ms folds once and settles heads-up", () => {
		const clock = fakeClock();
		const state = match(2, clock.nowMs);
		const captured = { ...turn(state) };
		expect(TURN_MS).toBe(12_000);
		expect(captured.deadlineAt).toBe(12_000);
		freezeTree(state);
		clock.nowMs = 11_999;
		expect(expireTurn(state, captured, clock.nowMs)).toEqual({
			expired: false,
			state,
		});
		expect(expireTurn(state, captured, clock.nowMs).state).toBe(state);
		clock.nowMs = 12_000;
		const result = expireTurn(state, captured, clock.nowMs);
		expect(result.expired).toBe(true);
		expect(result.state.public.seats[0]?.folded).toBe(true);
		expect(result.state.public.handStatus).toBe("settled");
		expect(result.state.public.actor).toBeNull();
		expect(result.state.public.turn).toBeNull();
		expect(result.state.public.board).toEqual([]);
		expect(result.state.public.settlement?.reason).toBe("folded");
		expect(result.state.public.settlement?.showdownSeatIndices).toEqual([]);
		expect(result.state.public.settlement?.refunds).toEqual([
			{ amount: 5, seatIndex: 1 },
		]);
		expect(result.state.public.seats.map((seat) => seat.stack)).toEqual([
			195, 205,
		]);
		expect(chips(result.state)).toBe(400);
		expect(expireTurn(result.state, captured, clock.nowMs + 50).state).toBe(
			result.state
		);
		expect(expireTurn(result.state, captured, clock.nowMs + 50).expired).toBe(
			false
		);
	});

	test("multiway late expiry starts the next actor at expiry time plus 12000", () => {
		const clock = fakeClock(500);
		const state = match(4, clock.nowMs);
		const captured = turn(state);
		clock.nowMs = captured.deadlineAt + 8000;
		const result = expireTurn(state, captured, clock.nowMs);
		expect(result.expired).toBe(true);
		expect(result.state.public.seats[captured.actorIndex]?.folded).toBe(true);
		expect(result.state.public.actor).toBe(0);
		expect(turn(result.state).deadlineAt).toBe(clock.nowMs + TURN_MS);
		expect(turn(result.state).turnId).toBe(captured.turnId + 1);
		expect(chips(result.state)).toBe(800);
		expect(expireTurn(result.state, captured, clock.nowMs).state).toBe(
			result.state
		);
	});

	test("disconnection/resume and public view/JSON cloning cannot extend a deadline", () => {
		const clock = fakeClock(10_000);
		const room = { connected: [true, true], engine: match(2, clock.nowMs) };
		const captured = turn(room.engine);
		room.connected[captured.actorIndex] = false;
		clock.nowMs += 5000;
		expect(turn(room.engine)).toBe(captured);
		const view = structuredClone(room.engine.public);
		expect(view.turn).toEqual(captured);
		const restored = JSON.parse(JSON.stringify(room.engine)) as MatchState;
		expect(assignDeadline(restored, clock.nowMs)).toBe(restored);
		expect(turn(restored).deadlineAt).toBe(captured.deadlineAt);
		room.connected[captured.actorIndex] = true;
		expect(assignDeadline(room.engine, clock.nowMs)).toBe(room.engine);
		expect(turn(room.engine)).toBe(captured);
		room.connected[captured.actorIndex] = false;
		clock.nowMs = captured.deadlineAt;
		expect(
			expireTurn(room.engine, captured, clock.nowMs).state.public.seats[
				captured.actorIndex
			]?.folded
		).toBe(true);
	});

	test("timeout during preflop BB option folds rather than the legal check", () => {
		let state = play(match(), { type: "call" }, 40);
		const captured = turn(state);
		expect(captured.actorIndex).toBe(state.public.bigBlindIndex);
		expect(
			legalActions(state, captured.actorIndex).actions.map(
				(action) => action.type
			)
		).toContain("check");
		({ state } = expireTurn(state, captured, captured.deadlineAt));
		expect(state.public.seats[captured.actorIndex]?.folded).toBe(true);
		expect(state.public.street).toBe("preflop");
		expect(state.public.handStatus).toBe("settled");
		expect(chips(state)).toBe(400);
	});

	test("postflop check-available actor also auto-folds", () => {
		let state = play(match(3), { type: "call" }, 10);
		state = play(state, { type: "call" }, 20);
		state = play(state, { type: "check" }, 30);
		const captured = turn(state);
		expect(captured.street).toBe("flop");
		expect(legalActions(state, captured.actorIndex).callAmount).toBe(0);
		const next = expireTurn(state, captured, captured.deadlineAt).state;
		expect(next.public.seats[captured.actorIndex]?.folded).toBe(true);
		expect(next.public.handStatus).toBe("playing");
		expect(chips(next)).toBe(600);
	});

	test("stale callback after accepted action cannot fold the next or repeated actor", () => {
		const state = match(3);
		const captured = { ...turn(state) };
		let next = play(state, { type: "call" }, 100);
		expect(expireTurn(next, captured, captured.deadlineAt).state).toBe(next);
		next = play(next, { totalTo: 20, type: "raise" }, 200);
		next = play(next, { type: "call" }, 300);
		expect(turn(next).actorIndex).toBe(captured.actorIndex);
		expect(turn(next).street).toBe(captured.street);
		expect(turn(next).turnId).toBeGreaterThan(captured.turnId);
		freezeTree(next);
		expect(expireTurn(next, captured, 50_000)).toEqual({
			expired: false,
			state: next,
		});
		expect(expireTurn(next, captured, 50_000).state).toBe(next);
		expect(next.public.seats.some((seat) => seat.folded)).toBe(false);
	});

	test("each identity component fences obsolete timers, including prior hands", () => {
		const state = match(3);
		const captured = turn(state);
		const obsolete: TurnDeadline[] = [
			{ ...captured, actorIndex: 1 },
			{ ...captured, handNumber: 2 },
			{ ...captured, turnId: captured.turnId + 1 },
			{ ...captured, deadlineAt: captured.deadlineAt + 1 },
			{ ...captured, street: "flop" },
		];
		for (const token of obsolete) {
			expect(expireTurn(state, token, 100_000)).toEqual({
				expired: false,
				state,
			});
			expect(expireTurn(state, token, 100_000).state).toBe(state);
		}
		const first = match();
		const old = turn(first);
		const settled = expireTurn(first, old, old.deadlineAt).state;
		const next = startNextHandAt(settled, 50_000, fullDeck);
		expect(turn(next).handNumber).toBe(2);
		expect(turn(next).deadlineAt).toBe(62_000);
		expect(expireTurn(next, old, 100_000).state).toBe(next);
	});

	test("idempotent normalization and illegal actions preserve the turn object", () => {
		const state = match(4, 100);
		const captured = turn(state);
		expect(assignDeadline(state, 9000)).toBe(state);
		expect(progressBettingAt(state, 9000).public.turn).toBe(captured);
		for (const [seat, action] of [
			[1, { type: "fold" }],
			[captured.actorIndex, { type: "check" }],
			[captured.actorIndex, { totalTo: 11, type: "raise" }],
		] as const) {
			const result = applyActionAt(state, seat, action, 9000);
			expect(result.ok).toBe(false);
			expect(result.state).toBe(state);
			expect(result.state.public.turn).toBe(captured);
		}
	});

	test("all-in, inactive and folded seats never receive a deadline", () => {
		let state = shortHand([200, 200, 1, 0], 100);
		expect(state.public.seats[2]?.allIn).toBe(true);
		expect(state.public.seats[3]?.inHand).toBe(false);
		const seen: number[] = [];
		while (state.public.handStatus === "playing") {
			const current = turn(state);
			seen.push(current.actorIndex);
			const actor = state.public.seats[current.actorIndex];
			expect(actor?.folded).toBe(false);
			expect(actor?.allIn).toBe(false);
			expect(actor?.inHand).toBe(true);
			({ state } = expireTurn(state, current, current.deadlineAt));
		}
		expect(seen).not.toContain(2);
		expect(seen).not.toContain(3);
		expect(state.public.turn).toBeNull();
		expect(chips(state)).toBe(401);
	});

	test("blind-only all-in boundary runs out and settles without phantom deadlines", () => {
		const state = shortHand([3, 5]);
		expect(state.public.handStatus).toBe("settled");
		expect(state.public.board).toHaveLength(5);
		expect(state.public.turn).toBeNull();
		expect(state.public.actor).toBeNull();
		expect(chips(state)).toBe(8);
	});

	test("legacy initial assignment and explicit street wrappers time the new actor", () => {
		const raw = startMatch([{ id: "a" }, { id: "b" }], fullDeck);
		expect(raw.public.turn).toBeUndefined();
		const initial = assignDeadline(raw, 500);
		expect(turn(initial).deadlineAt).toBe(12_500);
		const flop = advanceStreetAt(initial, 1000);
		expect(turn(flop).street).toBe("flop");
		expect(turn(flop).deadlineAt).toBe(13_000);
		expect(turn(flop).turnId).toBe(turn(initial).turnId + 1);
		expect(chips(flop)).toBe(chips(initial));
	});

	test("injected clocks reject invalid or unrepresentable millisecond values", () => {
		for (const nowMs of [
			-1,
			0.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.MAX_SAFE_INTEGER,
		]) {
			expect(() => match(2, nowMs)).toThrow(RangeError);
		}
	});
});

for (const count of [2, 3, 4]) {
	for (const timeoutsOnly of [true, false]) {
		test(`seeded ${count}-seat ${timeoutsOnly ? "timeouts-only" : "random-actions/timeouts"}: 1000 hands conserve and terminate`, () => {
			const entropy = seeded(0xd3_ad_00_33 + count + Number(timeoutsOnly));
			const random = (bound: number) => boundedIndex(bound, entropy);
			const deckSource = () => shuffleDeck(fullDeck(), entropy);
			const clock = fakeClock(1_000_000);
			const seats = Array.from({ length: count }, (_, index) => ({
				id: `s${index}`,
			}));
			let state = startMatchAt(seats, clock.nowMs, deckSource);
			let timeoutCount = 0;
			let actionCount = 0;
			let showdownCount = 0;
			for (let hand = 0; hand < 1000; hand += 1) {
				const total = chips(state);
				let transitions = 0;
				while (state.public.handStatus === "playing") {
					assert.ok(
						transitions < 2000,
						"hand must terminate within bounded turns"
					);
					transitions += 1;
					const captured = { ...turn(state) };
					assert.equal(captured.actorIndex, state.public.actor);
					assert.equal(captured.handNumber, state.public.handNumber);
					assert.equal(captured.street, state.public.street);
					const actor = state.public.seats[captured.actorIndex];
					assert.ok(
						actor?.inHand && !actor.folded && !actor.allIn && actor.stack > 0
					);
					freezeTree(state);
					const before = JSON.stringify(state);
					if (timeoutsOnly || random(3) === 0) {
						assert.equal(
							expireTurn(state, captured, captured.deadlineAt - 1).state,
							state
						);
						clock.nowMs = captured.deadlineAt + random(20_000);
						const result = expireTurn(state, captured, clock.nowMs);
						assert.ok(result.expired);
						assert.equal(JSON.stringify(state), before);
						({ state } = result);
						assert.ok(state.public.seats[captured.actorIndex]?.folded);
						timeoutCount += 1;
					} else {
						clock.nowMs = captured.deadlineAt - TURN_MS + random(TURN_MS);
						const offered = legalActions(state, captured.actorIndex).actions;
						const selected = offered[random(offered.length)];
						assert.ok(selected);
						const action: BettingAction = { type: selected.type };
						if (selected.type === "bet" || selected.type === "raise") {
							const minimum = selected.minTotalTo as number;
							const maximum = selected.maxTotalTo as number;
							action.totalTo = minimum + random(maximum - minimum + 1);
						}
						const result = applyActionAt(
							state,
							captured.actorIndex,
							action,
							clock.nowMs
						);
						assert.ok(result.ok);
						assert.equal(JSON.stringify(state), before);
						({ state } = result);
						actionCount += 1;
					}
					assert.equal(chips(state), total);
					for (const seat of state.public.seats) {
						assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
						assert.ok(
							Number.isSafeInteger(seat.handContribution) &&
								seat.handContribution >= 0
						);
					}
					assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
					assert.equal(
						expireTurn(state, captured, clock.nowMs + TURN_MS * 2).state,
						state
					);
					if (state.public.handStatus === "playing") {
						assert.equal(turn(state).deadlineAt, clock.nowMs + TURN_MS);
						assert.ok(turn(state).turnId > captured.turnId);
						assert.equal(
							assignDeadline(state, clock.nowMs + 500).public.turn,
							state.public.turn
						);
					}
				}
				assert.equal(state.public.handStatus, "settled");
				assert.equal(state.public.turn, null);
				assert.equal(state.public.actor, null);
				assert.equal(state.public.settlement?.totalChips, total);
				assert.equal(chips(state), total);
				if (state.public.settlement?.reason === "showdown") {
					showdownCount += 1;
				}
				clock.nowMs += random(1000);
				state = state.public.seats.every((seat) => seat.stack > 0)
					? startNextHandAt(state, clock.nowMs, deckSource)
					: startMatchAt(seats, clock.nowMs, deckSource);
				if (state.public.handStatus === "playing") {
					assert.equal(turn(state).deadlineAt, clock.nowMs + TURN_MS);
				} else {
					assert.equal(state.public.turn, null);
				}
			}
			assert.ok(timeoutCount >= 1000 || !timeoutsOnly);
			if (!timeoutsOnly) {
				assert.ok(timeoutCount > 0 && actionCount > 0 && showdownCount > 0);
			}
		});
	}
}
