import type { Card } from "./cards";

export const STARTING_STACK = 200;
export const BLINDS = { big: 10, small: 5 } as const;
export type Street = "preflop" | "flop" | "turn" | "river";

/** Room metadata, tokens, revisions and clocks belong outside the rules engine. */
export interface SeatInput {
	id: string;
}

export interface SeatState extends SeatInput {
	allIn: boolean;
	folded: boolean;
	handContribution: number;
	/** Fixed for this hand: busted/unoccupied seats do not receive cards or turns. */
	inHand: boolean;
	stack: number;
	streetContribution: number;
}

/** Safe public poker fields, not a complete viewer-specific protocol snapshot. */
export interface PublicMatchState {
	actor: number | null;
	bigBlindIndex: number;
	blinds: { small: number; big: number };
	board: Card[];
	dealerIndex: number;
	handNumber: number;
	seats: SeatState[];
	smallBlindIndex: number;
	street: Street;
}

/** Server-owned only. Never serialize this object to a client or a log. */
export interface PrivateHandState {
	/** Complete permutation; nextCardIndex separates dealt from undealt cards. */
	deck: Card[];
	/** Indexed by seat; inactive seats have an empty array. */
	holeCards: Card[][];
	nextCardIndex: number;
}

/** Plain JSON data; no RNG, functions, clocks or transport revisions are stored. */
export interface MatchState {
	private: PrivateHandState;
	public: PublicMatchState;
}
