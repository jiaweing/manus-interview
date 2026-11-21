/** Shared card primitives for the pure poker engine. Ranks 2..14 (14 = ace). */
export const SUITS = ["c", "d", "h", "s"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [
	2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

export interface Card {
	readonly rank: Rank;
	readonly suit: Suit;
}

const WHITESPACE = /\s+/;
const RANK_CHARS = "23456789TJQKA";

/** Parse a two-character code such as "As", "Td", "2c". Throws on invalid input. */
export function card(code: string): Card {
	const rankIndex = RANK_CHARS.indexOf(code.charAt(0).toUpperCase());
	const suit = code.charAt(1).toLowerCase();
	if (
		code.length !== 2 ||
		rankIndex < 0 ||
		!(SUITS as readonly string[]).includes(suit)
	) {
		throw new Error(`Invalid card code: ${code}`);
	}
	return { rank: (rankIndex + 2) as Rank, suit: suit as Suit };
}

/** Parse a whitespace separated list such as "As Kd 2c". */
export function cards(codes: string): Card[] {
	return codes.trim().split(WHITESPACE).filter(Boolean).map(card);
}

export function cardCode(c: Card): string {
	return `${RANK_CHARS.charAt(c.rank - 2)}${c.suit}`;
}

/** The canonical, ordered 52-card deck. */
export function fullDeck(): Card[] {
	return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}
