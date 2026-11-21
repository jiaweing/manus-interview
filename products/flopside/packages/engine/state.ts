import type { Card } from "./cards";
import type { TurnDeadline } from "./deadline";
import type { MatchResult } from "./lifecycle";

export const STARTING_STACK = 200;
export const BLINDS = { big: 10, small: 5 } as const;
export type Street = "preflop" | "flop" | "turn" | "river";
/** Folded/showdown are ready to settle; settled means chips have been awarded. */
export type HandStatus = "playing" | "folded" | "showdown" | "settled";

export interface ChipPayout {
	amount: number;
	seatIndex: number;
}

export interface SettledPot {
	amount: number;
	/** Upper inclusive contribution tier, after the unmatched refund. */
	contributionLevel: number;
	contributorSeatIndices: number[];
	eligibleSeatIndices: number[];
	payouts: ChipPayout[];
	/** Clockwise from immediately left of the dealer; also the odd-chip order. */
	winnerSeatIndices: number[];
}

export interface SeatSettlement {
	/** Original hand contribution, before refunds. */
	contribution: number;
	finalStack: number;
	/** Pot awards + refund - original contribution; may be negative. */
	netPayout: number;
	/** Gross pot awards, excluding the refund. */
	payout: number;
	refund: number;
	seatIndex: number;
}

/** Public accounting only: no ranks, best-five cards or private hole cards. */
export interface HandSettlement {
	pots: SettledPot[];
	reason: "folded" | "showdown";
	refunds: ChipPayout[];
	/** Stable seat-index order, including inactive/folded seats. */
	seats: SeatSettlement[];
	/** All non-folded in-hand seats at contested showdown; empty on a fold win. */
	showdownSeatIndices: number[];
	/** Stacks + unresolved contributions before = stacks after settlement. */
	totalChips: number;
	/** Sum of pot amounts after the unmatched refund. */
	totalPot: number;
}

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
	/** Injected by lifecycle entry points; independent of turn identity (#33). */
	handId?: string;
	handNumber: number;
	handStatus: HandStatus;
	lastFullRaiseIncrement: number;
	matchId?: string;
	/** One shared result after settlement; null in lifecycle-managed live matches. */
	result?: MatchResult | null;
	seats: SeatState[];
	/** Null until settlement; reset by startNextHand. */
	settlement: HandSettlement | null;
	smallBlindIndex: number;
	street: Street;
	/** Clock-aware deadline API sets this; legacy transitions remain untimed. */
	turn?: TurnDeadline | null;
}

/** Server-owned only. Never serialize this object to a client or a log. */
export interface PrivateHandState {
	/** Complete permutation; nextCardIndex separates dealt from undealt cards. */
	deck: Card[];
	/** Indexed by seat; inactive seats have an empty array. */
	holeCards: Card[][];
	nextCardIndex: number;
	/** Null/absent until expiry is requested; [] still means termination pending. */
	pendingExpiryConnectedSeatIds?: string[] | null;
}

/** Plain JSON data; no RNG, functions, clocks or transport revisions are stored. */
export interface MatchState {
	private: PrivateHandState;
	public: PublicMatchState;
}
