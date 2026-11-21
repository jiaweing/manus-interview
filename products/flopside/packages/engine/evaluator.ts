import type { Card, Suit } from "./cards";

export const HAND_LABELS = [
	"High card",
	"One pair",
	"Two pair",
	"Three of a kind",
	"Straight",
	"Flush",
	"Full house",
	"Four of a kind",
	"Straight flush",
] as const;

export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Larger categories win; within a category compare tiebreaks lexicographically. */
export interface HandRank {
	readonly category: HandCategory;
	readonly tiebreak: readonly number[];
}

export interface EvaluatedHand extends HandRank {
	readonly bestFive: readonly Card[];
	readonly label: (typeof HAND_LABELS)[HandCategory];
}

/** Positive means a wins, negative means b wins. Suits are deliberately ignored. */
export function compareHands(a: HandRank, b: HandRank): -1 | 0 | 1 {
	if (a.category !== b.category) {
		return a.category > b.category ? 1 : -1;
	}
	for (
		let index = 0;
		index < Math.max(a.tiebreak.length, b.tiebreak.length);
		index += 1
	) {
		const left = a.tiebreak[index] ?? 0;
		const right = b.tiebreak[index] ?? 0;
		if (left !== right) {
			return left > right ? 1 : -1;
		}
	}
	return 0;
}

function straightHigh(counts: Uint8Array): number {
	let consecutive = 0;
	for (let rank = 14; rank >= 2; rank -= 1) {
		consecutive = counts[rank] ? consecutive + 1 : 0;
		if (consecutive === 5) {
			return rank + 4;
		}
	}
	// Ace is low only in this exact wheel; it never wraps another sequence.
	return counts[14] && counts[5] && counts[4] && counts[3] && counts[2] ? 5 : 0;
}

function straightRanks(high: number): number[] {
	return high === 5
		? [5, 4, 3, 2, 14]
		: [high, high - 1, high - 2, high - 3, high - 4];
}

function highestRanks(
	counts: Uint8Array,
	limit: number,
	excludeFirst?: number,
	excludeSecond?: number
): number[] {
	const ranks: number[] = [];
	for (let rank = 14; rank >= 2 && ranks.length < limit; rank -= 1) {
		if (counts[rank] && rank !== excludeFirst && rank !== excludeSecond) {
			ranks.push(rank);
		}
	}
	return ranks;
}

function tally(cards: Card[]): {
	counts: Uint8Array;
	flushCards: Card[];
	flushCounts: Uint8Array;
} {
	const counts = new Uint8Array(15);
	const suited: Record<Suit, Card[]> = { c: [], d: [], h: [], s: [] };
	for (const card of cards) {
		const group = suited[card.suit];
		if (group.some((candidate) => candidate.rank === card.rank)) {
			throw new RangeError("evaluateBest requires distinct cards");
		}
		group.push(card);
		counts[card.rank] = (counts[card.rank] ?? 0) + 1;
	}
	const flushCards =
		Object.values(suited).find((group) => group.length >= 5) ?? [];
	const flushCounts = new Uint8Array(15);
	for (const card of flushCards) {
		flushCounts[card.rank] = 1;
	}
	return { counts, flushCards, flushCounts };
}

function rankGroups(counts: Uint8Array): {
	pairs: number[];
	trips: number[];
	quads: number;
} {
	const pairs: number[] = [];
	const trips: number[] = [];
	let quads = 0;
	for (let rank = 14; rank >= 2; rank -= 1) {
		const count = counts[rank] ?? 0;
		if (count === 4) {
			quads = rank;
		}
		if (count >= 3) {
			trips.push(rank);
		}
		if (count >= 2) {
			pairs.push(rank);
		}
	}
	return { pairs, quads, trips };
}

/** Resolve rank targets to original cards. Equal-ranked suits only choose a representative. */
function result(
	cards: Card[],
	category: HandCategory,
	tiebreak: number[],
	ranks: number[]
): EvaluatedHand {
	const bestFive: Card[] = [];
	for (const rank of ranks) {
		const chosen = cards.find(
			(candidate) => candidate.rank === rank && !bestFive.includes(candidate)
		);
		if (!chosen) {
			throw new Error("Cannot select best-five cards from rank targets");
		}
		bestFive.push(chosen);
	}
	return { bestFive, category, label: HAND_LABELS[category], tiebreak };
}

/**
 * Evaluate 5..7 distinct cards without mutation, I/O, clocks or randomness.
 * Tiebreaks: high/flush = five descending ranks; pair = pair + three kickers;
 * two pair = high pair + low pair + kicker; trips = trips + two kickers;
 * straight/straight flush = high card (wheel = 5); full house = trips + pair;
 * quads = quads + kicker. Royal flush is category 8 with tiebreak [14].
 * bestFive is a representative winning subset, ordered by those rank groups.
 */
export function evaluateBest(cards: Card[]): EvaluatedHand {
	if (cards.length < 5 || cards.length > 7) {
		throw new RangeError("evaluateBest requires 5 to 7 cards");
	}
	const { counts, flushCards, flushCounts } = tally(cards);
	const flushStraight = straightHigh(flushCounts);
	if (flushStraight) {
		return result(flushCards, 8, [flushStraight], straightRanks(flushStraight));
	}
	const { pairs, trips, quads } = rankGroups(counts);
	if (quads) {
		const kickers = highestRanks(counts, 1, quads);
		return result(
			cards,
			7,
			[quads, ...kickers],
			[quads, quads, quads, quads, ...kickers]
		);
	}
	const [trip] = trips;
	const housePair = pairs.find((rank) => rank !== trip);
	if (trip !== undefined && housePair !== undefined) {
		return result(
			cards,
			6,
			[trip, housePair],
			[trip, trip, trip, housePair, housePair]
		);
	}
	if (flushCards.length) {
		const ranks = highestRanks(flushCounts, 5);
		return result(flushCards, 5, ranks, ranks);
	}
	const straight = straightHigh(counts);
	if (straight) {
		return result(cards, 4, [straight], straightRanks(straight));
	}
	if (trip !== undefined) {
		const kickers = highestRanks(counts, 2, trip);
		return result(cards, 3, [trip, ...kickers], [trip, trip, trip, ...kickers]);
	}
	const [highPair, lowPair] = pairs;
	if (highPair !== undefined && lowPair !== undefined) {
		const kickers = highestRanks(counts, 1, highPair, lowPair);
		return result(
			cards,
			2,
			[highPair, lowPair, ...kickers],
			[highPair, highPair, lowPair, lowPair, ...kickers]
		);
	}
	if (highPair !== undefined) {
		const kickers = highestRanks(counts, 3, highPair);
		return result(
			cards,
			1,
			[highPair, ...kickers],
			[highPair, highPair, ...kickers]
		);
	}
	const ranks = highestRanks(counts, 5);
	return result(cards, 0, ranks, ranks);
}
