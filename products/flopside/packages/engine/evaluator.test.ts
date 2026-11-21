import { describe, expect, test } from "bun:test";
import { type Card, cardCode, cards, fullDeck } from "./cards";
import {
	compareHands,
	type EvaluatedHand,
	evaluateBest,
	HAND_LABELS,
	type HandCategory,
	type HandRank,
} from "./evaluator";

function rankOf(hand: HandRank): HandRank {
	return { category: hand.category, tiebreak: hand.tiebreak };
}

interface Fixture {
	readonly bestRanks?: readonly number[];
	readonly category: HandCategory;
	readonly input: string;
	readonly tiebreak: readonly number[];
}

const CATEGORIES: readonly Fixture[] = [
	{ category: 0, input: "As Kd Jh 9c 7d 4h 2s", tiebreak: [14, 13, 11, 9, 7] },
	{ category: 1, input: "As Ad Kh Qc 9d 4h 2s", tiebreak: [14, 13, 12, 9] },
	{ category: 2, input: "As Ad Kh Kc 9d 4h 2s", tiebreak: [14, 13, 9] },
	{ category: 3, input: "As Ad Ah Kc 9d 4h 2s", tiebreak: [14, 13, 9] },
	{ category: 4, input: "9s 8d 7h 6c 5d Ah 2s", tiebreak: [9] },
	{ category: 5, input: "As Js 9s 6s 3s Kd 2h", tiebreak: [14, 11, 9, 6, 3] },
	{ category: 6, input: "As Ad Ah Kc Kd 4h 2s", tiebreak: [14, 13] },
	{ category: 7, input: "As Ad Ah Ac Kd 4h 2s", tiebreak: [14, 13] },
	{ category: 8, input: "9s 8s 7s 6s 5s Ah 2d", tiebreak: [9] },
];

const EDGE_CASES: readonly Fixture[] = [
	{
		bestRanks: [5, 4, 3, 2, 14],
		category: 4,
		input: "As 2d 3h 4c 5d",
		tiebreak: [5],
	},
	{
		bestRanks: [6, 5, 4, 3, 2],
		category: 4,
		input: "As 2d 3h 4c 5d 6h Kc",
		tiebreak: [6],
	},
	{ category: 0, input: "Qs Kd Ah 2c 3d", tiebreak: [14, 13, 12, 3, 2] },
	{ category: 0, input: "Js Qd Kh Ac 2d 3h 4s", tiebreak: [14, 13, 12, 11, 4] },
	{
		bestRanks: [5, 4, 3, 2, 14],
		category: 8,
		input: "As 2s 3s 4s 5s Kd Qh",
		tiebreak: [5],
	},
	{ category: 8, input: "As Ks Qs Js Ts 2d 3h", tiebreak: [14] },
	{ category: 8, input: "As 9s 8s 7s 6s 5s Kd", tiebreak: [9] },
	{ category: 5, input: "As Js 9s 6s 3s 2s Kd", tiebreak: [14, 11, 9, 6, 3] },
	{ category: 5, input: "As Ks 9s 6s 3s Qd Jh", tiebreak: [14, 13, 9, 6, 3] },
	{ category: 5, input: "As 9s 8s 7s 3s 6d 5h", tiebreak: [14, 9, 8, 7, 3] },
	{ category: 5, input: "Qs Ks As 2s 3s", tiebreak: [14, 13, 12, 3, 2] },
	{
		bestRanks: [14, 14, 14, 13, 13],
		category: 6,
		input: "As Ad Ah Kc Kd Kh Qs",
		tiebreak: [14, 13],
	},
	{ category: 6, input: "Qs Qd Qh Ac Ad Kc Kd", tiebreak: [12, 14] },
	{
		bestRanks: [13, 13, 13, 13, 14],
		category: 7,
		input: "Ks Kd Kh Kc As Ad 2h",
		tiebreak: [13, 14],
	},
	{
		bestRanks: [14, 14, 13, 13, 12],
		category: 2,
		input: "As Ad Kh Kc Qd Qh 2s",
		tiebreak: [14, 13, 12],
	},
	{
		bestRanks: [11, 11, 9, 9, 14],
		category: 2,
		input: "Js Jd 9h 9c 8d 8h As",
		tiebreak: [11, 9, 14],
	},
	{ category: 3, input: "Qs Qd Qh As Kd Jh 9c", tiebreak: [12, 14, 13] },
	{ category: 1, input: "Qs Qd As Kc Jh 9d 2c", tiebreak: [12, 14, 13, 11] },
	{ category: 4, input: "As Kd Qh Jc Td 9h 8s", tiebreak: [14] },
	{ category: 4, input: "8s 7d 6h 5c 4d 3h 2s", tiebreak: [8] },
];

function checkFixture(fixture: Fixture): void {
	const input = cards(fixture.input);
	const snapshot = input.map(cardCode);
	const actual = evaluateBest(input);
	const expected = { category: fixture.category, tiebreak: fixture.tiebreak };
	const message = `Input ${fixture.input}; expected rank ${JSON.stringify(expected)}`;
	expect(rankOf(actual), message).toEqual(expected);
	expect(actual.label, message).toBe(HAND_LABELS[fixture.category]);
	expect(actual.bestFive.length, message).toBe(5);
	expect(new Set(actual.bestFive).size, message).toBe(5);
	expect(
		actual.bestFive.every((card) => input.includes(card)),
		message
	).toBe(true);
	expect(rankOf(evaluateBest([...actual.bestFive])), message).toEqual(expected);
	expect(input.map(cardCode), message).toEqual(snapshot);
	if (fixture.bestRanks) {
		const actualRanks: readonly number[] = actual.bestFive.map(
			(card) => card.rank
		);
		expect(actualRanks, message).toEqual(fixture.bestRanks);
	}
}

describe("all nine ordered categories", () => {
	for (const fixture of CATEGORIES) {
		test(`${HAND_LABELS[fixture.category]}: ${fixture.input} => ${fixture.category}/${fixture.tiebreak}`, () => {
			checkFixture(fixture);
		});
	}
	test("every higher category wins even against an ace-high lower category", () => {
		for (const [index, weaker] of CATEGORIES.entries()) {
			for (const stronger of CATEGORIES.slice(index + 1)) {
				const message = `${stronger.input} expected ${stronger.category}/${stronger.tiebreak} beats ${weaker.input} expected ${weaker.category}/${weaker.tiebreak}`;
				expect(
					compareHands(
						evaluateBest(cards(stronger.input)),
						evaluateBest(cards(weaker.input))
					),
					message
				).toBe(1);
			}
		}
	});
});

describe("best-five edge cases", () => {
	for (const fixture of EDGE_CASES) {
		test(`${fixture.input} => ${fixture.category}/${fixture.tiebreak}`, () => {
			checkFixture(fixture);
		});
	}
});

interface Comparison {
	readonly comparison: -1 | 0 | 1;
	readonly description: string;
	readonly expectedLeft: HandRank;
	readonly expectedRight: HandRank;
	readonly left: string;
	readonly right: string;
}

const COMPARISONS: readonly Comparison[] = [
	{
		comparison: -1,
		description: "five-high loses to six-high",
		expectedLeft: { category: 4, tiebreak: [5] },
		expectedRight: { category: 4, tiebreak: [6] },
		left: "As 2d 3h 4c 5d",
		right: "2s 3d 4h 5c 6d",
	},
	{
		comparison: 1,
		description: "paired-hand final kicker matters",
		expectedLeft: { category: 1, tiebreak: [14, 13, 12, 9] },
		expectedRight: { category: 1, tiebreak: [14, 13, 12, 8] },
		left: "As Ad Kh Qc 9d 4h 2s",
		right: "Ac Ah Ks Qd 8c 4s 2d",
	},
	{
		comparison: 1,
		description: "pair rank precedes kickers",
		expectedLeft: { category: 1, tiebreak: [13, 12, 11, 9] },
		expectedRight: { category: 1, tiebreak: [12, 14, 13, 11] },
		left: "Ks Kd Qh Jc 9d",
		right: "Qs Qd As Kc Jh",
	},
	{
		comparison: 1,
		description: "two-pair kicker matters",
		expectedLeft: { category: 2, tiebreak: [14, 13, 12] },
		expectedRight: { category: 2, tiebreak: [14, 13, 11] },
		left: "As Ad Kh Kc Qd 4h 2s",
		right: "Ac Ah Ks Kd Jc 4s 2d",
	},
	{
		comparison: 1,
		description: "two-pair lower pair precedes kicker",
		expectedLeft: { category: 2, tiebreak: [14, 13, 2] },
		expectedRight: { category: 2, tiebreak: [14, 12, 13] },
		left: "As Ad Kh Kc 2d",
		right: "Ac Ah Qs Qd Kc",
	},
	{
		comparison: 1,
		description: "full-house trips precede pair",
		expectedLeft: { category: 6, tiebreak: [14, 2] },
		expectedRight: { category: 6, tiebreak: [13, 14] },
		left: "As Ad Ah 2c 2d",
		right: "Ks Kd Kh Ac Ad",
	},
	{
		comparison: 1,
		description: "full-house pair breaks equal trips",
		expectedLeft: { category: 6, tiebreak: [14, 13] },
		expectedRight: { category: 6, tiebreak: [14, 12] },
		left: "As Ad Ah Kc Kd",
		right: "Ac Ad Ah Qc Qd",
	},
	{
		comparison: 1,
		description: "quads kicker matters",
		expectedLeft: { category: 7, tiebreak: [13, 14] },
		expectedRight: { category: 7, tiebreak: [13, 12] },
		left: "Ks Kd Kh Kc As",
		right: "Ks Kd Kh Kc Qs",
	},
	{
		comparison: 1,
		description: "trip final kicker matters",
		expectedLeft: { category: 3, tiebreak: [12, 14, 13] },
		expectedRight: { category: 3, tiebreak: [12, 14, 11] },
		left: "Qs Qd Qh As Kc",
		right: "Qc Qd Qh Ac Js",
	},
	{
		comparison: 1,
		description: "flush fifth card matters",
		expectedLeft: { category: 5, tiebreak: [14, 11, 9, 6, 3] },
		expectedRight: { category: 5, tiebreak: [14, 11, 9, 6, 2] },
		left: "As Js 9s 6s 3s",
		right: "Ah Jh 9h 6h 2h",
	},
	{
		comparison: 0,
		description: "board-only tie ignores unused hole-card kickers",
		expectedLeft: { category: 8, tiebreak: [14] },
		expectedRight: { category: 8, tiebreak: [14] },
		left: "As Ks Qs Js Ts 9d 8c",
		right: "As Ks Qs Js Ts 2d 3c",
	},
	{
		comparison: 0,
		description: "paired board plays for both players",
		expectedLeft: { category: 2, tiebreak: [14, 13, 12] },
		expectedRight: { category: 2, tiebreak: [14, 13, 12] },
		left: "As Ad Kh Kc Qd 9c 8c",
		right: "As Ad Kh Kc Qd 2h 3h",
	},
	{
		comparison: 0,
		description: "suit-independent equality",
		expectedLeft: { category: 1, tiebreak: [14, 13, 12, 9] },
		expectedRight: { category: 1, tiebreak: [14, 13, 12, 9] },
		left: "As Ad Kh Qc 9d",
		right: "Ac Ah Ks Qd 9c",
	},
	{
		comparison: 0,
		description: "flushes of different suits tie",
		expectedLeft: { category: 5, tiebreak: [14, 11, 9, 6, 3] },
		expectedRight: { category: 5, tiebreak: [14, 11, 9, 6, 3] },
		left: "As Js 9s 6s 3s",
		right: "Ah Jh 9h 6h 3h",
	},
	{
		comparison: 0,
		description: "split-pot straight uses different hole cards",
		expectedLeft: { category: 4, tiebreak: [14] },
		expectedRight: { category: 4, tiebreak: [14] },
		left: "As Kd Qh Jc 2d Ts 3s",
		right: "As Kd Qh Jc 2d Th 4h",
	},
];

describe("ordered tiebreaks and split-pot equality", () => {
	for (const comparison of COMPARISONS) {
		test(`${comparison.description}: ${comparison.left} vs ${comparison.right}; expected ${JSON.stringify(comparison.expectedLeft)} vs ${JSON.stringify(comparison.expectedRight)}`, () => {
			const left = evaluateBest(cards(comparison.left));
			const right = evaluateBest(cards(comparison.right));
			expect(rankOf(left)).toEqual(comparison.expectedLeft);
			expect(rankOf(right)).toEqual(comparison.expectedRight);
			expect(compareHands(left, right)).toBe(comparison.comparison);
			const reverse = { "-1": 1, 0: 0, 1: -1 } as const;
			expect(compareHands(right, left)).toBe(reverse[comparison.comparison]);
			expect(compareHands(left, left)).toBe(0);
		});
	}
	test("both board-only winners return exactly the five board cards", () => {
		const board = cards("As Ks Qs Js Ts");
		const expected = board.map(cardCode).sort();
		for (const hole of ["9d 8c", "2d 3c"]) {
			const hand = evaluateBest([...board, ...cards(hole)]);
			expect(
				hand.bestFive.map(cardCode).sort(),
				`${hole}; expected board ${expected} and rank 8/[14]`
			).toEqual(expected);
		}
	});
});

test("rejects counts outside 5..7 and duplicate physical cards", () => {
	for (const input of [
		"",
		"As Kd Qh Jc",
		"As Kd Qh Jc Ts 9d 8h 7c",
		"As As Qh Jc Ts",
	]) {
		expect(
			() => evaluateBest(cards(input)),
			`Input ${input}; expected RangeError`
		).toThrow(RangeError);
	}
});

/** The RNG is explicitly injected into sampling; no ambient Math.random. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 48_271) % 2_147_483_647;
		return state / 2_147_483_647;
	};
}

function sampleSeven(deck: Card[], random: () => number): Card[] {
	const remaining = [...deck];
	const sample: Card[] = [];
	for (let index = 0; index < 7; index += 1) {
		const chosen = Math.floor(random() * remaining.length);
		const [card] = remaining.splice(chosen, 1);
		if (!card) {
			throw new Error("Cannot sample a card from the deck");
		}
		sample.push(card);
	}
	return sample;
}

/** Independent subset search: omitting each distinct pair gives all 21 subsets. */
function bruteForceBest(seven: Card[]): EvaluatedHand {
	let best = evaluateBest(seven.slice(0, 5));
	for (let first = 0; first < 7; first += 1) {
		for (let second = first + 1; second < 7; second += 1) {
			const five = seven.filter(
				(_, index) => index !== first && index !== second
			);
			const candidate = evaluateBest(five);
			if (compareHands(candidate, best) > 0) {
				best = candidate;
			}
		}
	}
	return best;
}

test("3,000 seeded seven-card hands match the max of all 21 five-card subsets", () => {
	const seed = 0x29_20_26;
	const random = seededRandom(seed);
	const deck = fullDeck();
	for (let iteration = 0; iteration < 3000; iteration += 1) {
		const input = sampleSeven(deck, random);
		const expected = bruteForceBest(input);
		const actual = evaluateBest(input);
		const message = `Seed ${seed}, iteration ${iteration}, input ${input.map(cardCode).join(" ")}; expected rank ${JSON.stringify(rankOf(expected))}`;
		expect(rankOf(actual), message).toEqual(rankOf(expected));
		expect(rankOf(evaluateBest([...actual.bestFive])), message).toEqual(
			rankOf(expected)
		);
		expect(
			actual.bestFive.every((card) => input.includes(card)),
			message
		).toBe(true);
		expect(rankOf(evaluateBest([...input].reverse())), message).toEqual(
			rankOf(expected)
		);
		const six = evaluateBest(input.slice(0, 6));
		const five = evaluateBest(input.slice(0, 5));
		expect(compareHands(actual, six), message).toBeGreaterThanOrEqual(0);
		expect(compareHands(six, five), message).toBeGreaterThanOrEqual(0);
	}
}, 20_000);

test("all C(52,5)=2,598,960 hands have the exact known category distribution (including four royals)", () => {
	const deck = fullDeck();
	const counts = new Array<number>(9).fill(0);
	const five: Card[] = [];
	let total = 0;
	let royals = 0;
	for (let a = 0; a < 48; a += 1) {
		five[0] = deck[a] as Card;
		for (let b = a + 1; b < 49; b += 1) {
			five[1] = deck[b] as Card;
			for (let c = b + 1; c < 50; c += 1) {
				five[2] = deck[c] as Card;
				for (let d = c + 1; d < 51; d += 1) {
					five[3] = deck[d] as Card;
					for (let e = d + 1; e < 52; e += 1) {
						five[4] = deck[e] as Card;
						const rank = evaluateBest(five);
						counts[rank.category] = (counts[rank.category] ?? 0) + 1;
						total += 1;
						if (rank.category === 8 && rank.tiebreak[0] === 14) {
							royals += 1;
						}
					}
				}
			}
		}
	}
	const expected = [
		1_302_540, 1_098_240, 123_552, 54_912, 10_200, 5108, 3744, 624, 40,
	];
	const message = `All five-card combinations from ${deck.map(cardCode).join(" ")}; expected counts by category 0..8: ${expected}`;
	expect(total, message).toBe(2_598_960);
	expect(counts, message).toEqual(expected);
	expect(
		royals,
		"All five-card combinations; expected four category 8/[14] royal flushes"
	).toBe(4);
}, 20_000);
