import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Card, cardCode, cards, fullDeck } from "./cards";
import { advanceStreet, nextActor, startMatch, startNextHand } from "./dealing";
import { boundedIndex, productionDeck, shuffleDeck } from "./shuffle";
import type { MatchState, SeatState } from "./state";

const NON_CRYPTO_RANDOM = /Math\s*\.\s*random\b/;
const UINT32_RANGE = 2 ** 32;
const ORDER_CASES = [
	{ big: 1, count: 2, postflop: 1, preflop: 0, small: 0 },
	{ big: 2, count: 3, postflop: 1, preflop: 0, small: 1 },
	{ big: 2, count: 4, postflop: 1, preflop: 3, small: 1 },
] as const;

function roster(count: number) {
	return Array.from({ length: count }, (_, index) => ({ id: `seat-${index}` }));
}

function fixture(): Card[] {
	const prefix = cards("As Kd Qh Jc Ts 9d 8h 7c 6s 5d 4h 3c 2s");
	const used = new Set(prefix.map(cardCode));
	return [...prefix, ...fullDeck().filter((card) => !used.has(cardCode(card)))];
}

function seatAt(state: MatchState, index: number): SeatState {
	const seat = state.public.seats[index];
	if (!seat) {
		throw new Error("Missing fixture seat");
	}
	return seat;
}

function sequence(values: number[]): () => number {
	let cursor = 0;
	return () => {
		const value = values[cursor];
		cursor += 1;
		if (value === undefined) {
			throw new Error("Exhausted entropy fixture");
		}
		return value;
	};
}

function dealtCards(state: MatchState): Card[] {
	return [...state.private.holeCards.flat(), ...state.public.board];
}

function expectPermutation(deck: readonly Card[]) {
	expect(deck).toHaveLength(52);
	expect(new Set(deck.map(cardCode)).size).toBe(52);
	expect(deck.map(cardCode).sort()).toEqual(fullDeck().map(cardCode).sort());
}

describe("dealing and clockwise action order", () => {
	for (const scenario of ORDER_CASES) {
		test(`${scenario.count} seats: 200 chips, 5/10 blinds, and first actors`, () => {
			const state = startMatch(roster(scenario.count), fixture);
			expect(state.public.handNumber).toBe(1);
			expect(state.public.dealerIndex).toBe(0);
			expect(state.public.blinds).toEqual({ big: 10, small: 5 });
			expect(state.public.smallBlindIndex).toBe(scenario.small);
			expect(state.public.bigBlindIndex).toBe(scenario.big);
			expect(state.public.actor).toBe(scenario.preflop);
			expect(state.public.street).toBe("preflop");
			expect(state.public.board).toEqual([]);
			for (const [index, seat] of state.public.seats.entries()) {
				const blind = index === scenario.small ? 5 : 0;
				const posted = index === scenario.big ? 10 : blind;
				expect(seat.stack).toBe(200 - posted);
				expect(seat.stack + seat.handContribution).toBe(200);
				expect(seat.streetContribution).toBe(posted);
				expect(seat.handContribution).toBe(posted);
				expect(seat.folded).toBe(false);
				expect(seat.allIn).toBe(false);
				expect(seat.inHand).toBe(true);
				expect(state.private.holeCards[index]).toHaveLength(2);
			}
			expectPermutation(state.private.deck);
			expect(advanceStreet(state).public.actor).toBe(scenario.postflop);
		});

		test(`${scenario.count} seats: every preflop and postflop turn is clockwise`, () => {
			const state = startMatch(roster(scenario.count), fixture);
			let actor = state.public.actor as number;
			for (let offset = 1; offset <= scenario.count; offset += 1) {
				actor = nextActor(state, actor) as number;
				expect(actor).toBe((scenario.preflop + offset) % scenario.count);
			}
			const flop = advanceStreet(state);
			actor = flop.public.actor as number;
			for (let offset = 1; offset <= scenario.count; offset += 1) {
				actor = nextActor(flop, actor) as number;
				expect(actor).toBe((scenario.postflop + offset) % scenario.count);
			}
		});

		test(`${scenario.count} seats: board 0/3/4/5, no burns, and unique cards`, () => {
			let state = startMatch(roster(scenario.count), fixture);
			for (const [street, count] of [
				["preflop", 0],
				["flop", 3],
				["turn", 4],
				["river", 5],
			] as const) {
				if (street !== "preflop") {
					const before = JSON.stringify(state);
					const previous = state;
					state = advanceStreet(previous);
					expect(JSON.stringify(previous)).toBe(before);
				}
				expect(state.public.street).toBe(street);
				expect(state.public.board).toHaveLength(count);
				expect(state.public.board).toEqual(
					fixture().slice(scenario.count * 2, scenario.count * 2 + count)
				);
				expect(state.private.nextCardIndex).toBe(scenario.count * 2 + count);
				const dealt = dealtCards(state);
				expect(new Set(dealt.map(cardCode)).size).toBe(dealt.length);
				if (street !== "preflop") {
					expect(
						state.public.seats.map((seat) => seat.streetContribution)
					).toEqual(new Array<number>(scenario.count).fill(0));
				}
				expect(seatAt(state, scenario.small).handContribution).toBe(5);
				expect(seatAt(state, scenario.big).handContribution).toBe(10);
			}
			expect(() => advanceStreet(state)).toThrow("River is the final street");
		});

		test(`${scenario.count} seats: dealer rotates and new-hand fields reset`, () => {
			let state = startMatch(roster(scenario.count), fixture);
			for (let hand = 2; hand <= scenario.count + 1; hand += 1) {
				// Simulate settlement: #32 will award/refund these contributions.
				for (const seat of state.public.seats) {
					seat.stack += seat.handContribution;
					seat.folded = true;
				}
				state = advanceStreet(state);
				const before = JSON.stringify(state);
				const previous = state;
				state = startNextHand(previous, fixture);
				expect(JSON.stringify(previous)).toBe(before);
				const dealer = (hand - 1) % scenario.count;
				const small =
					scenario.count === 2 ? dealer : (dealer + 1) % scenario.count;
				const big = (small + 1) % scenario.count;
				expect(state.public.handNumber).toBe(hand);
				expect(state.public.dealerIndex).toBe(dealer);
				expect(state.public.smallBlindIndex).toBe(small);
				expect(state.public.bigBlindIndex).toBe(big);
				expect(state.public.actor).toBe((big + 1) % scenario.count);
				expect(advanceStreet(state).public.actor).toBe(
					(dealer + 1) % scenario.count
				);
				expect(state.public.street).toBe("preflop");
				expect(state.public.board).toEqual([]);
				expect(
					state.public.seats.every((seat) => !(seat.folded || seat.allIn))
				).toBe(true);
				expect(
					state.public.seats.reduce(
						(sum, seat) => sum + seat.stack + seat.handContribution,
						0
					)
				).toBe(scenario.count * 200);
			}
		});
	}

	test("heads-up deals round-robin left of dealer, and dealer acts last postflop", () => {
		const state = startMatch(roster(2), fixture);
		expect(state.private.holeCards.map((hole) => hole.map(cardCode))).toEqual([
			["Kd", "Jc"],
			["As", "Qh"],
		]);
		for (let street = advanceStreet(state); ; street = advanceStreet(street)) {
			expect(street.public.actor).toBe(1);
			expect(nextActor(street)).toBe(0);
			if (street.public.street === "river") {
				break;
			}
		}
	});

	test("folded and all-in seats are skipped without mutating state", () => {
		const state = startMatch(roster(4), fixture);
		seatAt(state, 1).folded = true;
		seatAt(state, 2).allIn = true;
		const before = JSON.stringify(state);
		expect(nextActor(state, 0)).toBe(3);
		expect(nextActor(state, 3)).toBe(0);
		expect(JSON.stringify(state)).toBe(before);
		let street = state;
		for (let index = 0; index < 3; index += 1) {
			street = advanceStreet(street);
			expect(street.public.actor).toBe(3);
			expect(nextActor(street)).toBe(0);
		}
	});

	test("no eligible actor is null; all-in hands can still run out", () => {
		let state = startMatch(roster(3), fixture);
		seatAt(state, 0).folded = true;
		seatAt(state, 1).allIn = true;
		seatAt(state, 2).allIn = true;
		expect(nextActor(state)).toBeNull();
		for (let index = 0; index < 3; index += 1) {
			state = advanceStreet(state);
			expect(state.public.actor).toBeNull();
		}
		expect(state.public.board).toHaveLength(5);
	});

	test("a single eligible actor is circular; round completion belongs to betting", () => {
		const state = startMatch(roster(2), fixture);
		seatAt(state, 1).allIn = true;
		expect(nextActor(state, 0)).toBe(0);
	});

	test("dealer rotation skips busted seats and switches to heads-up order", () => {
		const previous = startMatch(roster(4), fixture);
		seatAt(previous, 1).stack = 0;
		seatAt(previous, 3).stack = 0;
		const state = startNextHand(previous, fixture);
		expect(state.public.dealerIndex).toBe(2);
		expect(state.public.smallBlindIndex).toBe(2);
		expect(state.public.bigBlindIndex).toBe(0);
		expect(state.public.actor).toBe(2);
		expect(state.private.holeCards.map((hole) => hole.length)).toEqual([
			2, 0, 2, 0,
		]);
		expect(nextActor(state, 0)).toBe(2);
		expect(advanceStreet(state).public.actor).toBe(0);
		expect(startNextHand(state, fixture).public.dealerIndex).toBe(0);
	});

	test("three funded seats in a four-seat roster use multi-seat order across gaps", () => {
		const previous = startMatch(roster(4), fixture);
		seatAt(previous, 1).stack = 0;
		const state = startNextHand(previous, fixture);
		expect(state.public.dealerIndex).toBe(2);
		expect(state.public.smallBlindIndex).toBe(3);
		expect(state.public.bigBlindIndex).toBe(0);
		expect(state.public.actor).toBe(2);
		expect(advanceStreet(state).public.actor).toBe(3);
		expect(nextActor(state, 0)).toBe(2);
		expect(state.private.holeCards.map((hole) => hole.length)).toEqual([
			2, 0, 2, 2,
		]);
	});

	test("a heads-up short small blind leaves the big blind as the first eligible actor", () => {
		const previous = startMatch(roster(2), fixture);
		seatAt(previous, 1).stack = 3;
		const state = startNextHand(previous, fixture);
		expect(state.public.dealerIndex).toBe(1);
		expect(seatAt(state, 1).allIn).toBe(true);
		expect(state.public.actor).toBe(0);
		expect(advanceStreet(state).public.actor).toBe(0);
	});

	for (const count of [2, 3, 4]) {
		test(`${count} seats: short small/big blinds post only their stacks`, () => {
			const previous = startMatch(roster(count), fixture);
			const small = count === 2 ? 1 : 2;
			const big = (small + 1) % count;
			seatAt(previous, small).stack = 3;
			seatAt(previous, big).stack = 7;
			const state = startNextHand(previous, fixture);
			for (const [index, amount] of [
				[small, 3],
				[big, 7],
			] as const) {
				const seat = seatAt(state, index);
				expect(seat.stack).toBe(0);
				expect(seat.streetContribution).toBe(amount);
				expect(seat.handContribution).toBe(amount);
				expect(seat.allIn).toBe(true);
			}
			if (count === 2) {
				expect(state.public.actor).toBeNull();
				expect(advanceStreet(state).public.actor).toBeNull();
			} else {
				const expected = count === 3 ? 1 : 0;
				expect(state.public.actor).toBe(expected);
				expect(advanceStreet(state).public.actor).toBe(expected);
			}
		});
	}

	test("exact blind stacks also become all-in", () => {
		const previous = startMatch(roster(2), fixture);
		seatAt(previous, 1).stack = 5;
		seatAt(previous, 0).stack = 10;
		const state = startNextHand(previous, fixture);
		expect(
			state.public.seats.every((seat) => seat.allIn && seat.stack === 0)
		).toBe(true);
		expect(state.public.actor).toBeNull();
	});

	test("each new street resets new contributions but preserves stacks, totals, flags and holes", () => {
		let state = startMatch(roster(3), fixture);
		for (let index = 0; index < 3; index += 1) {
			for (const seat of state.public.seats) {
				seat.streetContribution = 20;
				seat.handContribution += 20;
				seat.stack -= 20;
			}
			seatAt(state, 1).folded = true;
			const previous = state;
			state = advanceStreet(previous);
			expect(state.private.holeCards).toEqual(previous.private.holeCards);
			for (const [seatIndex, seat] of state.public.seats.entries()) {
				expect(seat).toEqual({
					...seatAt(previous, seatIndex),
					streetContribution: 0,
				});
			}
		}
	});

	test("state is plain JSON and fixtures are copied, not retained as runtime config", () => {
		const deck = fixture();
		const input = roster(2);
		const before = JSON.stringify(input);
		let calls = 0;
		const state = startMatch(input, () => {
			calls += 1;
			return deck;
		});
		expect(calls).toBe(1);
		expect(JSON.stringify(input)).toBe(before);
		expect(JSON.parse(JSON.stringify(state))).toEqual(state);
		expect(state.public).not.toHaveProperty("deck");
		expect(state.public).not.toHaveProperty("holeCards");
		expect(state.private.deck[0]).not.toBe(deck[0]);
		deck.reverse();
		expect(state.private.deck).toEqual(fixture());
	});

	test("match/hand/deck preconditions reject invalid inputs", () => {
		for (const count of [0, 1, 5]) {
			expect(() => startMatch(roster(count), fixture)).toThrow("two to four");
		}
		expect(() => startMatch([{ id: "x" }, { id: "x" }], fixture)).toThrow(
			"unique"
		);
		expect(() => startMatch([{ id: "" }, { id: "x" }], fixture)).toThrow(
			"nonempty"
		);
		expect(() => startMatch(roster(2), () => fixture().slice(1))).toThrow(
			"52-card"
		);
		expect(() =>
			startMatch(roster(2), () =>
				new Array<Card>(52).fill(cards("As")[0] as Card)
			)
		).toThrow("52-card");
		expect(() =>
			startMatch(roster(2), () => [
				...fixture().slice(1),
				{ rank: 15, suit: "s" } as unknown as Card,
			])
		).toThrow("52-card");
		const state = startMatch(roster(2), fixture);
		seatAt(state, 1).stack = 0;
		expect(() => startNextHand(state, fixture)).toThrow("two funded seats");
		seatAt(state, 0).stack = 0;
		expect(() => startNextHand(state, fixture)).toThrow("two funded seats");
		seatAt(state, 1).stack = -1;
		seatAt(state, 0).stack = 100;
		expect(() => startNextHand(state, fixture)).toThrow(
			"nonnegative safe integers"
		);
		expect(() => nextActor(state, -1)).toThrow("seat index");
		expect(() => nextActor(state, 2)).toThrow("seat index");
		expect(() => nextActor(state, 0.5)).toThrow("seat index");
	});
});

describe("unbiased server shuffle", () => {
	test("rejection sampling discards the incomplete high bucket, including its boundary", () => {
		let calls = 0;
		const source = sequence([
			UINT32_RANGE - 1,
			UINT32_RANGE - 6,
			UINT32_RANGE - 7,
		]);
		expect(
			boundedIndex(10, () => {
				calls += 1;
				return source();
			})
		).toBe(9);
		expect(calls).toBe(3);
	});

	test("bounded-index endpoints and power-of-two bounds are exact", () => {
		expect(boundedIndex(1, () => UINT32_RANGE - 1)).toBe(0);
		expect(boundedIndex(UINT32_RANGE, () => UINT32_RANGE - 1)).toBe(
			UINT32_RANGE - 1
		);
		expect(boundedIndex(16, () => UINT32_RANGE - 1)).toBe(15);
		expect(boundedIndex(52, () => 0)).toBe(0);
	});

	test("bounded indices have a chi-square sanity check with deterministic uint32 entropy", () => {
		let value = 42;
		const counts = new Array<number>(10).fill(0);
		const source = () => {
			value = (value * 1_664_525 + 1_013_904_223) % UINT32_RANGE;
			return value;
		};
		for (let draw = 0; draw < 100_000; draw += 1) {
			const index = boundedIndex(10, source);
			counts[index] = (counts[index] as number) + 1;
		}
		const expected = 10_000;
		const chiSquare = counts.reduce(
			(sum, observed) => sum + (observed - expected) ** 2 / expected,
			0
		);
		expect(chiSquare).toBeLessThan(30);
	});

	test("bounded-index source contract and invalid bounds fail closed", () => {
		for (const bound of [0, -1, 1.5, UINT32_RANGE + 1, Number.NaN]) {
			expect(() => boundedIndex(bound, () => 0)).toThrow(RangeError);
		}
		for (const value of [-1, UINT32_RANGE, 0.5, Number.NaN]) {
			expect(() => boundedIndex(10, () => value)).toThrow(RangeError);
		}
	});

	test("Fisher–Yates uses each descending bound, operates on a copy, and yields a permutation", () => {
		const input = fullDeck();
		let calls = 0;
		const shuffled = shuffleDeck(input, () => {
			calls += 1;
			return 0;
		});
		expect(calls).toBe(51);
		expect(shuffled).toEqual([...input.slice(1), ...input.slice(0, 1)]);
		expect(input).toEqual(fullDeck());
		expectPermutation(shuffled);
	});

	test("all six three-card permutations are reachable with the expected bounds", () => {
		const results = new Set<string>();
		for (let first = 0; first < 3; first += 1) {
			for (let second = 0; second < 2; second += 1) {
				results.add(
					shuffleDeck(cards("As Kd Qh"), sequence([first, second]))
						.map(cardCode)
						.join(" ")
				);
			}
		}
		expect(results.size).toBe(6);
	});

	test("default production entropy produces complete deck permutations", () => {
		for (let sample = 0; sample < 32; sample += 1) {
			expectPermutation(productionDeck());
		}
		expectPermutation(startMatch(roster(2)).private.deck);
	});

	test("every engine TypeScript source is free of non-cryptographic randomness", () => {
		const directory = fileURLToPath(new URL(".", import.meta.url));
		for (const file of readdirSync(directory).filter((name) =>
			name.endsWith(".ts")
		)) {
			expect(readFileSync(`${directory}/${file}`, "utf8")).not.toMatch(
				NON_CRYPTO_RANDOM
			);
		}
	});
});
