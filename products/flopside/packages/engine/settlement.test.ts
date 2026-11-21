import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert/strict";
import {
	applyAction,
	type BettingAction,
	legalActions,
	progressBetting,
} from "./betting";
import { cardCode, cards, fullDeck } from "./cards";
import { startMatch, startNextHand } from "./dealing";
import { compareHands, evaluateBest } from "./evaluator";
import { settleHand } from "./settlement";
import { boundedIndex, shuffleDeck, type Uint32Source } from "./shuffle";
import type { HandSettlement, MatchState, SettledPot } from "./state";

const BOARD = "2c 4d 7h 9s Jc";
const HOLES = ["As Ah", "Ks Kh", "Qs Qh", "Ts Th"];
const SPLIT_BOARD = "Th Jh Qh Kh Ah";
const SPLIT_HOLES = ["2c 3c", "4c 5c", "6c 7c", "8c 9c"];

function match(count: number): MatchState {
	return startMatch(
		Array.from({ length: count }, (_, index) => ({ id: `s${index}` })),
		fullDeck
	);
}
function chips(state: MatchState): number {
	return state.public.seats.reduce(
		(sum, seat) => sum + seat.stack + seat.handContribution,
		0
	);
}
function fixture(
	contributions: number[],
	options: {
		board?: string;
		dealer?: number;
		folded?: number[];
		holes?: string[];
		stacks?: number[];
		uncontested?: boolean;
	} = {}
): MatchState {
	const state = match(contributions.length);
	state.public.board = cards(options.board ?? BOARD);
	state.public.dealerIndex = options.dealer ?? 0;
	state.public.actor = null;
	state.public.handStatus = options.uncontested ? "folded" : "showdown";
	state.public.street = options.uncontested ? "preflop" : "river";
	state.private.holeCards = (options.holes ?? HOLES)
		.slice(0, contributions.length)
		.map(cards);
	const used = [...state.private.holeCards.flat(), ...state.public.board];
	assert.equal(
		new Set(used.map(cardCode)).size,
		used.length,
		"fixture cards must be distinct"
	);
	state.private.deck = [
		...used,
		...fullDeck().filter(
			(card) => !used.some((other) => cardCode(card) === cardCode(other))
		),
	];
	state.private.nextCardIndex = used.length;
	for (const [index, seat] of state.public.seats.entries()) {
		const amount = contributions[index] as number;
		seat.handContribution = amount;
		seat.streetContribution = amount;
		seat.stack = options.stacks?.[index] ?? 200 - amount;
		seat.allIn = seat.stack === 0;
		seat.folded = options.folded?.includes(index) ?? false;
		seat.raiseAllowed = false;
	}
	return state;
}
function freezeTree(value: unknown): void {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			freezeTree(child);
		}
		Object.freeze(value);
	}
}

/**
 * Independent pot oracle: refund against the maximum of ALL other seats, then
 * deposit one chip from each contributor at each integer layer. Merge adjacent
 * layers only when their contributor sets match. No production tier sorting.
 */
function potOracle(state: MatchState) {
	const original = state.public.seats.map((seat) => seat.handContribution);
	const refunds = original.flatMap((amount, index) => {
		const others = original.filter((_, other) => other !== index);
		const excess = Math.max(0, amount - Math.max(0, ...others));
		return excess > 0 ? [{ amount: excess, seatIndex: index }] : [];
	});
	const contributions = original.map(
		(amount, index) =>
			amount -
			(refunds.find((refund) => refund.seatIndex === index)?.amount ?? 0)
	);
	const pots: Pick<
		SettledPot,
		| "amount"
		| "contributionLevel"
		| "contributorSeatIndices"
		| "eligibleSeatIndices"
	>[] = [];
	for (let chip = 1; chip <= Math.max(0, ...contributions); chip += 1) {
		const contributors: number[] = [];
		const eligible: number[] = [];
		for (let index = 0; index < contributions.length; index += 1) {
			if ((contributions[index] as number) >= chip) {
				contributors.push(index);
				const seat = state.public.seats[index];
				if (seat?.inHand && !seat.folded) {
					eligible.push(index);
				}
			}
		}
		const last = pots.at(-1);
		if (
			last &&
			last.contributorSeatIndices.join(",") === contributors.join(",")
		) {
			last.amount += contributors.length;
			last.contributionLevel = chip;
		} else {
			pots.push({
				amount: contributors.length,
				contributionLevel: chip,
				contributorSeatIndices: contributors,
				eligibleSeatIndices: eligible,
			});
		}
	}
	return { pots, refunds };
}

/** Check every fixture/property hand, not only total conservation. */
function assertSettlement(
	before: MatchState,
	after: MatchState
): HandSettlement {
	const result = after.public.settlement;
	assert.ok(result);
	assert.equal(after.public.handStatus, "settled");
	assert.equal(after.public.actor, null);
	assert.equal(chips(after), chips(before));
	assert.equal(result.totalChips, chips(before));
	assert.equal(
		after.public.seats.reduce((sum, seat) => sum + seat.stack, 0),
		chips(before)
	);
	assert.equal(result.reason, before.public.handStatus);
	const contenders = before.public.seats.flatMap((seat, index) =>
		seat.inHand && !seat.folded ? [index] : []
	);
	assert.deepEqual(
		result.showdownSeatIndices,
		before.public.handStatus === "showdown" ? contenders : []
	);
	const oracle = potOracle(before);
	assert.deepEqual(result.refunds, oracle.refunds);
	assert.deepEqual(
		result.pots.map(
			({
				amount,
				contributionLevel,
				contributorSeatIndices,
				eligibleSeatIndices,
			}) => ({
				amount,
				contributionLevel,
				contributorSeatIndices,
				eligibleSeatIndices,
			})
		),
		oracle.pots
	);
	assert.equal(
		result.totalPot,
		result.pots.reduce((sum, pot) => sum + pot.amount, 0)
	);
	assert.equal(
		result.totalPot +
			result.refunds.reduce((sum, refund) => sum + refund.amount, 0),
		before.public.seats.reduce((sum, seat) => sum + seat.handContribution, 0)
	);
	for (const pot of result.pots) {
		assert.ok(pot.winnerSeatIndices.length > 0);
		assert.equal(
			pot.payouts.reduce((sum, payout) => sum + payout.amount, 0),
			pot.amount
		);
		assert.deepEqual(
			pot.payouts.map((payout) => payout.seatIndex),
			pot.winnerSeatIndices
		);
		for (const winner of pot.winnerSeatIndices) {
			assert.ok(pot.eligibleSeatIndices.includes(winner));
			assert.ok(!before.public.seats[winner]?.folded);
		}
		let winningSeats = pot.eligibleSeatIndices;
		if (before.public.handStatus === "showdown") {
			const ranked = pot.eligibleSeatIndices.map((index) => ({
				index,
				rank: evaluateBest([
					...(before.private.holeCards[index] ?? []),
					...before.public.board,
				]),
			}));
			winningSeats = ranked
				.filter((candidate) =>
					ranked.every((other) => compareHands(candidate.rank, other.rank) >= 0)
				)
				.map((candidate) => candidate.index);
		}
		// Independent ordering by modular distance rather than a clockwise scan.
		winningSeats = [...winningSeats].sort(
			(a, b) =>
				((a - before.public.dealerIndex - 1 + before.public.seats.length) %
					before.public.seats.length) -
				((b - before.public.dealerIndex - 1 + before.public.seats.length) %
					before.public.seats.length)
		);
		assert.deepEqual(pot.winnerSeatIndices, winningSeats);
		assert.deepEqual(
			pot.payouts,
			winningSeats.map((seatIndex, order) => ({
				amount:
					Math.floor(pot.amount / winningSeats.length) +
					(order < pot.amount % winningSeats.length ? 1 : 0),
				seatIndex,
			}))
		);
	}
	assert.equal(
		result.seats.reduce((sum, seat) => sum + seat.netPayout, 0),
		0
	);
	for (const [index, seat] of after.public.seats.entries()) {
		const account: HandSettlement["seats"][number] | undefined =
			result.seats[index];
		assert.ok(account);
		assert.equal(account.seatIndex, index);
		assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
		assert.equal(seat.handContribution, 0);
		assert.equal(seat.streetContribution, 0);
		assert.equal(seat.raiseAllowed, false);
		assert.equal(legalActions(after, index).actions.length, 0);
		const contribution = before.public.seats[index]?.handContribution as number;
		const payout: number = result.pots
			.flatMap((pot) => pot.payouts)
			.filter((award) => award.seatIndex === index)
			.reduce((sum, award) => sum + award.amount, 0);
		const refund: number = result.refunds
			.filter((award) => award.seatIndex === index)
			.reduce((sum, award) => sum + award.amount, 0);
		assert.equal(account.contribution, contribution);
		assert.equal(account.payout, payout);
		assert.equal(account.refund, refund);
		assert.equal(account.netPayout, payout + refund - contribution);
		assert.equal(
			account.finalStack,
			(before.public.seats[index]?.stack as number) + payout + refund
		);
		assert.equal(account.finalStack, seat.stack);
	}
	assert.deepEqual(JSON.parse(JSON.stringify(after)), after);
	return result;
}
function settle(state: MatchState): HandSettlement {
	const snapshot = JSON.stringify(state);
	freezeTree(state);
	const after = settleHand(state);
	assert.equal(JSON.stringify(state), snapshot);
	assert.equal(after.private, state.private);
	assert.deepEqual(after.public.board, state.public.board);
	return assertSettlement(state, after);
}
function play(state: MatchState, action: BettingAction): MatchState {
	const index = state.public.actor;
	assert.notEqual(index, null);
	const snapshot = JSON.stringify(state);
	freezeTree(state);
	const result = applyAction(state, index as number, action);
	assert.ok(result.ok, `legal action rejected: ${JSON.stringify(action)}`);
	assert.equal(JSON.stringify(state), snapshot);
	assert.equal(chips(result.state), chips(state));
	return result.state;
}
function seeded(seed: number): Uint32Source {
	let value = seed;
	return () => {
		value = (value * 1_664_525 + 1_013_904_223) % 2 ** 32;
		return value;
	};
}

describe("settlement: refunds and side pots", () => {
	test("50/100/150 refunds 50 BEFORE constructing 150/100 pots", () => {
		const result = settle(fixture([50, 100, 150]));
		expect(result.refunds).toEqual([{ amount: 50, seatIndex: 2 }]);
		expect(
			result.pots.map((pot) => [
				pot.amount,
				pot.eligibleSeatIndices,
				pot.winnerSeatIndices,
			])
		).toEqual([
			[150, [0, 1, 2], [0]],
			[100, [1, 2], [1]],
		]);
		expect(result.seats.map((seat) => seat.finalStack)).toEqual([
			300, 200, 100,
		]);
		expect(result.seats.map((seat) => seat.netPayout)).toEqual([100, 0, -100]);
		expect(result.showdownSeatIndices).toEqual([0, 1, 2]);
	});
	test("equal highest contributions are called: no refund", () => {
		const result = settle(fixture([50, 100, 100]));
		expect(result.refunds).toEqual([]);
		expect(result.pots.map((pot) => pot.amount)).toEqual([150, 100]);
	});
	test("four seats, three distinct all-in levels and a singleton side-pot winner", () => {
		const result = settle(
			fixture([50, 100, 150, 150], { folded: [3], stacks: [0, 0, 0, 0] })
		);
		expect(
			result.pots.map((pot) => [
				pot.amount,
				pot.eligibleSeatIndices,
				pot.winnerSeatIndices,
			])
		).toEqual([
			[200, [0, 1, 2], [0]],
			[150, [1, 2], [1]],
			[100, [2], [2]],
		]);
		expect(result.seats.map((seat) => seat.finalStack)).toEqual([
			200, 150, 100, 0,
		]);
		expect(result.showdownSeatIndices).toEqual([0, 1, 2]);
	});
	test("folded contributions remain in BOTH main and side pots", () => {
		const result = settle(fixture([50, 100, 150, 100], { folded: [1] }));
		expect(result.refunds).toEqual([{ amount: 50, seatIndex: 2 }]);
		expect(
			result.pots.map((pot) => [
				pot.amount,
				pot.contributorSeatIndices,
				pot.eligibleSeatIndices,
			])
		).toEqual([
			[200, [0, 1, 2, 3], [0, 2, 3]],
			[150, [1, 2, 3], [2, 3]],
		]);
	});
	test("folded player with the best hand cannot win", () => {
		const result = settle(fixture([100, 100, 100], { folded: [0] }));
		expect(result.pots[0]?.winnerSeatIndices).toEqual([1]);
		expect(result.showdownSeatIndices).toEqual([1, 2]);
		expect(result.seats[0]?.payout).toBe(0);
	});
	test("folded private cards are never evaluated", () => {
		const state = fixture([50, 100, 100], { folded: [0] });
		state.private.holeCards[0] = [];
		const result = settle(state);
		expect(result.showdownSeatIndices).toEqual([1, 2]);
	});
	test("unmatched top folded contributor is refunded against ALL contributors", () => {
		const result = settle(fixture([150, 100, 100], { folded: [0] }));
		expect(result.refunds).toEqual([{ amount: 50, seatIndex: 0 }]);
		expect(result.pots[0]?.amount).toBe(300);
		expect(result.pots[0]?.winnerSeatIndices).toEqual([1]);
	});
	test("inactive zero-contribution seats are not contenders or eligible", () => {
		const state = fixture([100, 100, 0, 0], { stacks: [100, 100, 0, 0] });
		for (const index of [2, 3]) {
			const seat = state.public.seats[index];
			assert.ok(seat);
			seat.inHand = false;
			state.private.holeCards[index] = [];
		}
		const result = settle(state);
		expect(result.showdownSeatIndices).toEqual([0, 1]);
		expect(result.pots[0]?.eligibleSeatIndices).toEqual([0, 1]);
	});
	test("showdown includes a non-folded zero contributor even if never pot eligible", () => {
		const result = settle(fixture([50, 50, 0]));
		expect(result.showdownSeatIndices).toEqual([0, 1, 2]);
		expect(result.pots[0]?.eligibleSeatIndices).toEqual([0, 1]);
	});
});

describe("settlement: ties and deterministic odd chips", () => {
	test("board plays: all four seats share the main pot", () => {
		const result = settle(
			fixture([50, 50, 50, 50], { board: SPLIT_BOARD, holes: SPLIT_HOLES })
		);
		expect(result.pots[0]?.winnerSeatIndices).toEqual([1, 2, 3, 0]);
		expect(result.seats.map((seat) => seat.payout)).toEqual([50, 50, 50, 50]);
	});
	test("board plays across multiple pots with a refund and changing tie sets", () => {
		const result = settle(
			fixture([50, 100, 150, 200], { board: SPLIT_BOARD, holes: SPLIT_HOLES })
		);
		expect(result.refunds).toEqual([{ amount: 50, seatIndex: 3 }]);
		expect(
			result.pots.map((pot) => [pot.amount, pot.winnerSeatIndices])
		).toEqual([
			[200, [1, 2, 3, 0]],
			[150, [1, 2, 3]],
			[100, [2, 3]],
		]);
		expect(result.seats.map((seat) => seat.finalStack)).toEqual([
			200, 200, 200, 200,
		]);
	});
	for (const foldedContribution of [1, 2]) {
		test(`three-way split: ${foldedContribution} remainder chip(s), folded money in the main pot`, () => {
			const result = settle(
				fixture([7, 7, 7, foldedContribution], {
					board: SPLIT_BOARD,
					folded: [3],
					holes: SPLIT_HOLES,
				})
			);
			expect(result.pots.map((pot) => pot.amount)).toEqual([
				4 * foldedContribution,
				3 * (7 - foldedContribution),
			]);
			expect(result.pots[0]?.winnerSeatIndices).toEqual([1, 2, 0]);
			expect(result.seats.map((seat) => seat.payout)).toEqual(
				foldedContribution === 1 ? [7, 8, 7, 0] : [7, 8, 8, 0]
			);
		});
	}
	for (const dealer of [0, 1, 2]) {
		test(`heads-up tied pot with odd folded chip: dealer ${dealer} controls remainder`, () => {
			const result = settle(
				fixture([5, 5, 5], {
					board: SPLIT_BOARD,
					dealer,
					folded: [2],
					holes: SPLIT_HOLES,
				})
			);
			const first = dealer === 0 ? 1 : 0;
			expect(result.pots[0]?.payouts).toEqual([
				{ amount: 8, seatIndex: first },
				{ amount: 7, seatIndex: 1 - first },
			]);
		});
	}
	test("heads-up board split is exact when no odd chip exists", () => {
		const result = settle(
			fixture([101, 101], { board: SPLIT_BOARD, holes: SPLIT_HOLES })
		);
		expect(result.pots[0]?.payouts).toEqual([
			{ amount: 101, seatIndex: 1 },
			{ amount: 101, seatIndex: 0 },
		]);
	});
	test("tied hole-card hands split main and side pots; short stack can only win main", () => {
		const result = settle(
			fixture([51, 101, 151], {
				board: "2c 4d 7h 9s Jc",
				holes: ["As Kd", "Ad Ks", "Ah Kc"],
			})
		);
		expect(
			result.pots.map((pot) => [pot.amount, pot.winnerSeatIndices])
		).toEqual([
			[153, [1, 2, 0]],
			[100, [1, 2]],
		]);
		expect(result.seats.map((seat) => seat.finalStack)).toEqual([
			200, 200, 200,
		]);
	});
});

describe("settlement: completion, no exposure and lifecycle", () => {
	test("sole contender wins without board runout, cards, or evaluation", () => {
		const state = fixture([50, 100, 150], {
			board: "",
			folded: [0, 1],
			uncontested: true,
		});
		state.private.holeCards = [[], [], []];
		const result = settle(state);
		expect(result.reason).toBe("folded");
		expect(result.showdownSeatIndices).toEqual([]);
		expect(result.pots.map((pot) => pot.winnerSeatIndices)).toEqual([[2], [2]]);
		expect(result.seats[2]?.payout).toBe(250);
		expect(result.seats[2]?.refund).toBe(50);
	});
	test("sole contender preserves an existing flop without revealing cards", () => {
		const state = fixture([30, 30], {
			board: "2c 4d 7h",
			folded: [0],
			uncontested: true,
		});
		state.public.street = "flop";
		state.private.holeCards = [[], []];
		const result = settle(state);
		expect(result.showdownSeatIndices).toEqual([]);
		expect(result.pots[0]?.payouts).toEqual([{ amount: 60, seatIndex: 1 }]);
	});
	test("uncalled raise after fold returns the excess before awarding the pot", () => {
		let state = match(2);
		state = play(state, { totalTo: 75, type: "raise" });
		state = play(state, { type: "fold" });
		expect(state.public.handStatus).toBe("folded");
		expect(state.public.board).toHaveLength(0);
		const result = settle(state);
		expect(result.refunds).toEqual([{ amount: 65, seatIndex: 0 }]);
		expect(result.pots[0]?.payouts).toEqual([{ amount: 20, seatIndex: 0 }]);
		expect(result.seats.map((seat) => seat.finalStack)).toEqual([210, 190]);
	});
	test("folding the small blind refunds the big blind's uncalled excess", () => {
		const result = settle(play(match(2), { type: "fold" }));
		expect(result.refunds).toEqual([{ amount: 5, seatIndex: 1 }]);
		expect(result.pots[0]?.payouts).toEqual([{ amount: 10, seatIndex: 1 }]);
		expect(result.showdownSeatIndices).toEqual([]);
	});
	test("all-in runout reaches five cards before contested settlement", () => {
		let state = match(3);
		while (state.public.handStatus === "playing") {
			const offered = legalActions(state, state.public.actor as number).actions;
			state = play(state, {
				type: offered.some((action) => action.type === "allin")
					? "allin"
					: "call",
			});
		}
		expect(state.public.street).toBe("river");
		expect(state.public.board).toHaveLength(5);
		expect(state.public.handStatus).toBe("showdown");
		expect(settle(state).showdownSeatIndices).toEqual([0, 1, 2]);
	});
	test("blind-only all-ins normalize once, run out and refund unmatched blind chips", () => {
		const previous = match(2);
		for (const [index, seat] of previous.public.seats.entries()) {
			seat.stack = index === 0 ? 7 : 3;
			seat.handContribution = 0;
			seat.streetContribution = 0;
		}
		const dealt = startNextHand(previous, fullDeck);
		const state = progressBetting(dealt);
		expect(state.public.board).toHaveLength(5);
		expect(state.public.actor).toBeNull();
		expect(progressBetting(state)).toBe(state);
		const result = settle(state);
		expect(result.refunds).toEqual([{ amount: 4, seatIndex: 0 }]);
		expect(result.totalPot).toBe(6);
		expect(result.showdownSeatIndices).toEqual([0, 1]);
	});
	test("ordinary check/call betting closes the river before settlement", () => {
		let state = match(4);
		while (state.public.handStatus === "playing") {
			const offered = legalActions(state, state.public.actor as number).actions;
			state = play(state, {
				type: offered.some((action) => action.type === "check")
					? "check"
					: "call",
			});
		}
		expect(state.public.board).toHaveLength(5);
		expect(settle(state).showdownSeatIndices).toEqual([0, 1, 2, 3]);
	});
	test("startNextHand preserves final chips and resets settlement metadata", () => {
		const before = play(match(3), { type: "fold" });
		const ended = play(before, { type: "fold" });
		const settled = settleHand(ended);
		assertSettlement(ended, settled);
		const snapshot = JSON.stringify(settled);
		freezeTree(settled);
		const next = progressBetting(startNextHand(settled, fullDeck));
		expect(JSON.stringify(settled)).toBe(snapshot);
		expect(next.public.handNumber).toBe(2);
		expect(next.public.dealerIndex).toBe(1);
		expect(next.public.settlement).toBeNull();
		expect(next.public.handStatus).toBe("playing");
		expect(chips(next)).toBe(chips(settled));
	});
	test("empty pot accounting still conserves chips and declares showdown contenders", () => {
		const result = settle(fixture([0, 0]));
		expect(result.pots).toEqual([]);
		expect(result.totalPot).toBe(0);
		expect(result.showdownSeatIndices).toEqual([0, 1]);
	});
});

describe("settlement rejects invalid boundaries without mutation", () => {
	for (const [name, make] of [
		["unfinished hand", () => match(2)],
		[
			"actor still present",
			() => {
				const state = fixture([10, 10]);
				state.public.actor = 0;
				return state;
			},
		],
		["partial showdown board", () => fixture([10, 10], { board: "2c 4d 7h" })],
		[
			"fold status with multiple contenders",
			() => fixture([10, 10], { uncontested: true }),
		],
		["showdown with one contender", () => fixture([10, 10], { folded: [1] })],
		[
			"no contenders",
			() => fixture([10, 10], { folded: [0, 1], uncontested: true }),
		],
		["negative contribution", () => fixture([-1, 10])],
		["fractional contribution", () => fixture([1.5, 10])],
		[
			"unsafe total chips",
			() => fixture([10, 10], { stacks: [Number.MAX_SAFE_INTEGER, 0] }),
		],
		["invalid dealer", () => fixture([10, 10], { dealer: 2 })],
		[
			"missing contender hole cards",
			() => fixture([10, 10], { holes: ["", "As Ah"] }),
		],
		[
			"pot without an eligible contender",
			() => fixture([10, 20, 20], { folded: [1, 2], uncontested: true }),
		],
		["already settled hand", () => settleHand(fixture([10, 10]))],
	] as const) {
		test(name, () => {
			const state = make();
			const snapshot = JSON.stringify(state);
			freezeTree(state);
			expect(() => settleHand(state)).toThrow();
			expect(JSON.stringify(state)).toBe(snapshot);
		});
	}
});

describe("seeded end-to-end settlement property play", () => {
	for (const count of [2, 3, 4]) {
		test(`${count} seats: 2000 random legal hands, independent pot oracle and lifecycle chains`, () => {
			const rng = seeded(32_000 + count);
			const deckSource = () => shuffleDeck(fullDeck(), rng);
			let contested = 0;
			let folds = 0;
			let refunds = 0;
			let sidePots = 0;
			let turns = 0;
			let nextHands = 0;
			let state = progressBetting(
				startMatch(
					Array.from({ length: count }, (_, index) => ({ id: `s${index}` })),
					deckSource
				)
			);
			for (let hand = 0; hand < 2000; hand += 1) {
				const total = count * 200;
				assert.equal(chips(state), total);
				let steps = 0;
				while (state.public.handStatus === "playing") {
					assert.ok(
						steps < 1000,
						`seed ${32_000 + count}, hand ${hand}: betting loop`
					);
					const { actor } = state.public;
					assert.notEqual(actor, null);
					const descriptors = legalActions(state, actor as number).actions;
					assert.ok(descriptors.length > 0);
					// Alternate call-heavy, broad random, and all-in-heavy hands.
					let options = descriptors;
					if (hand % 3 === 0 && boundedIndex(5, rng) !== 0) {
						options = descriptors.filter(
							(offered) => offered.type === "check" || offered.type === "call"
						);
					} else if (
						hand % 3 === 2 &&
						descriptors.some((offered) => offered.type === "allin") &&
						boundedIndex(3, rng) !== 0
					) {
						options = descriptors.filter((offered) => offered.type === "allin");
					}
					const descriptor = options[boundedIndex(options.length, rng)];
					assert.ok(descriptor);
					const action: BettingAction = { type: descriptor.type };
					if (descriptor.type === "bet" || descriptor.type === "raise") {
						const minimum = descriptor.minTotalTo as number;
						action.totalTo =
							minimum +
							boundedIndex(
								(descriptor.maxTotalTo as number) - minimum + 1,
								rng
							);
					}
					state = play(state, action);
					assert.equal(chips(state), total);
					for (const seat of state.public.seats) {
						assert.ok(Number.isSafeInteger(seat.stack) && seat.stack >= 0);
						assert.ok(
							Number.isSafeInteger(seat.handContribution) &&
								seat.handContribution >= 0
						);
					}
					steps += 1;
					turns += 1;
				}
				if (state.public.handStatus === "showdown") {
					assert.equal(state.public.board.length, 5);
					contested += 1;
				} else {
					assert.equal(state.public.handStatus, "folded");
					folds += 1;
				}
				const snapshot = JSON.stringify(state);
				freezeTree(state);
				const after = settleHand(state);
				assert.equal(JSON.stringify(state), snapshot);
				const result = assertSettlement(state, after);
				refunds += result.refunds.length;
				sidePots += result.pots.length > 1 ? 1 : 0;
				// Chain settled winners' unequal stacks into later hands; restart a
				// match after a bust so every hand retains the original chip total.
				if (
					after.public.seats.every((seat) => seat.stack > 0) &&
					hand % 5 !== 4
				) {
					state = progressBetting(startNextHand(after, deckSource));
					nextHands += 1;
				} else {
					state = progressBetting(
						startMatch(
							Array.from({ length: count }, (_, index) => ({
								id: `s${index}`,
							})),
							deckSource
						)
					);
				}
				assert.equal(state.public.settlement, null);
			}
			assert.ok(contested > 0 && folds > 0 && refunds > 0);
			assert.ok(turns > 2000 && nextHands > 0);
			if (count > 2) {
				assert.ok(sidePots > 0);
			}
			console.info(
				`settlement seed=${32_000 + count} hands=2000 turns=${turns} showdowns=${contested} foldWins=${folds} refunds=${refunds} sidePotHands=${sidePots} chainedHands=${nextHands}`
			);
		}, 120_000);
	}
});
