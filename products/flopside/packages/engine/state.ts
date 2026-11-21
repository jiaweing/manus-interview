import type { Card } from "./cards";

export const STARTING_STACK = 200;
export const BLINDS = { big: 10, small: 5 } as const;
export type Street = "preflop" | "flop" | "turn" | "river";
/** Complete means ready for #32 settlement, not that chips have been awarded. */
export type HandStatus = "playing" | "folded" | "showdown";

/** Room metadata, tokens, revisions and clocks belong outside the rules engine. */
export interface SeatInput {
	id: string;
}

export interface SeatState extends SeatInput {
	actedThisRound: boolean;
	allIn: boolean;
	folded: boolean;
	handContribution: number;
	/** Fixed for this hand: busted/unoccupied seats do not receive cards or turns. */
	inHand: boolean;
	/** Wager level faced at this seat's last action; null before acting. */
	lastActedBet: number | null;
	/** Updated after every action, including cumulative short-raise reopening. */
	raiseAllowed: boolean;
	stack: number;
	streetContribution: number;
}

/** Safe public poker fields, not a complete viewer-specific protocol snapshot. */
export interface PublicMatchState {
	actor: number | null;
	bigBlindIndex: number;
	blinds: { small: number; big: number };
	board: Card[];
	currentBet: number;
	dealerIndex: number;
	handNumber: number;
	handStatus: HandStatus;
	lastFullRaiseIncrement: number;
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
