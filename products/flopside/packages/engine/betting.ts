import { advanceStreet, nextActor } from "./dealing";
import { BLINDS, type MatchState, type SeatState } from "./state";

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";

/** Transport maps its `action` field to `type`; totalTo is never an increment. */
export interface BettingAction {
	totalTo?: number;
	type: ActionType;
}

/** Wager ranges are inclusive integer totals; a short all-in has min === max. */
export interface LegalAction {
	maxTotalTo?: number;
	minTotalTo?: number;
	type: ActionType;
}

export interface LegalActions {
	actions: LegalAction[];
	/** Amount actually payable now, capped by the remaining stack. */
	callAmount: number;
	canRaise: boolean;
	maxTotalTo: number | null;
	/** Bounds for bet/raise, null if neither is available. */
	minTotalTo: number | null;
}

export type ActionResult =
	| { ok: true; state: MatchState }
	| {
			ok: false;
			state: MatchState;
			error: { code: "NOT_YOUR_TURN" | "ILLEGAL_ACTION"; message: string };
	  };

function canAct(seat: SeatState): boolean {
	return seat.inHand && !seat.folded && !seat.allIn && seat.stack > 0;
}

function bettingLevels(state: MatchState) {
	const fundedCount = state.public.seats.filter(canAct).length;
	const actualBet = state.public.seats.reduce(
		(maximum, seat) =>
			seat.inHand && !seat.folded
				? Math.max(maximum, seat.streetContribution)
				: maximum,
		0
	);
	return {
		actualBet,
		// Preserve the nominal bring-in only while opponents can create a side pot.
		callBet:
			fundedCount > 1
				? Math.max(actualBet, state.public.currentBet)
				: actualBet,
		fundedCount,
	};
}

function awaitsAction(
	seat: SeatState,
	actualBet: number,
	fundedCount: number
): boolean {
	return (
		canAct(seat) &&
		((fundedCount > 1 && !seat.actedThisRound) ||
			seat.streetContribution < actualBet)
	);
}

function hasRaiseRight(state: MatchState, seat: SeatState): boolean {
	return (
		!seat.actedThisRound ||
		(seat.lastActedBet !== null &&
			state.public.currentBet - seat.lastActedBet >=
				state.public.lastFullRaiseIncrement)
	);
}

/** Pure, viewer-safe HUD data. Non-actors and completed hands have no actions. */
export function legalActions(
	state: MatchState,
	seatIndex: number
): LegalActions {
	const none: LegalActions = {
		actions: [],
		callAmount: 0,
		canRaise: false,
		maxTotalTo: null,
		minTotalTo: null,
	};
	const seat = state.public.seats[seatIndex];
	if (
		!Number.isInteger(seatIndex) ||
		state.public.handStatus !== "playing" ||
		state.public.actor !== seatIndex ||
		!seat ||
		!canAct(seat)
	) {
		return none;
	}
	const { currentBet, lastFullRaiseIncrement, seats } = state.public;
	const { actualBet, callBet, fundedCount } = bettingLevels(state);
	if (!awaitsAction(seat, actualBet, fundedCount)) {
		return none;
	}
	const outstanding = Math.max(0, callBet - seat.streetContribution);
	const maximum = seat.streetContribution + seat.stack;
	// No dry-side-pot wagers against opponents who can no longer bet.
	const canRaise =
		hasRaiseRight(state, seat) &&
		maximum > currentBet &&
		seats.some((other, index) => index !== seatIndex && canAct(other));
	const actions: LegalAction[] = [
		{ type: "fold" },
		{ type: outstanding > 0 ? "call" : "check" },
	];
	let minimum: number | null = null;
	if (canRaise) {
		minimum = Math.min(
			maximum,
			currentBet === 0 ? BLINDS.big : currentBet + lastFullRaiseIncrement
		);
		actions.push({
			maxTotalTo: maximum,
			minTotalTo: minimum,
			type: currentBet === 0 ? "bet" : "raise",
		});
	}
	if (seat.stack <= outstanding || canRaise) {
		actions.push({
			maxTotalTo: maximum,
			minTotalTo: maximum,
			type: "allin",
		});
	}
	return {
		actions,
		callAmount: Math.min(outstanding, seat.stack),
		canRaise,
		maxTotalTo: canRaise ? maximum : null,
		minTotalTo: minimum,
	};
}

function completeHand(
	state: MatchState,
	handStatus: "folded" | "showdown"
): MatchState {
	return {
		...state,
		public: {
			...state.public,
			actor: null,
			handStatus,
			seats: state.public.seats.map((seat) => ({
				...seat,
				raiseAllowed: false,
			})),
		},
	};
}

/**
 * Close completed rounds and run out when no further betting is possible.
 * applyAction calls this automatically. Also call after startNextHand to resolve
 * hands with blind-only all-ins; dealing's lower-level API preserves its order contract.
 * A sole funded contender acts only if an actual live wager is outstanding.
 * The nominal bring-in never creates a dry-side-pot call. Chips are NEVER settled.
 */
export function progressBetting(
	state: MatchState,
	afterIndex?: number
): MatchState {
	if (state.public.handStatus !== "playing") {
		return state;
	}
	const contenders = state.public.seats.filter(
		(seat) => seat.inHand && !seat.folded
	);
	if (contenders.length === 1) {
		return completeHand(state, "folded");
	}
	const { actualBet, fundedCount } = bettingLevels(state);
	const pending = state.public.seats.filter((seat) =>
		awaitsAction(seat, actualBet, fundedCount)
	);
	if (fundedCount <= 1 && pending.length === 0) {
		let runout = state;
		while (runout.public.street !== "river") {
			runout = advanceStreet(runout);
		}
		return completeHand(runout, "showdown");
	}
	if (pending.length === 0) {
		return state.public.street === "river"
			? completeHand(state, "showdown")
			: advanceStreet(state);
	}
	let { actor } = state.public;
	if (
		afterIndex !== undefined ||
		actor === null ||
		!pending.includes(state.public.seats[actor] as SeatState)
	) {
		actor = nextActor(
			state,
			afterIndex ??
				(state.public.street === "preflop"
					? state.public.bigBlindIndex
					: state.public.dealerIndex)
		);
		while (
			actor !== null &&
			!pending.includes(state.public.seats[actor] as SeatState)
		) {
			actor = nextActor(state, actor);
		}
	}
	return {
		...state,
		public: {
			...state.public,
			actor,
		},
	};
}

function reject(
	state: MatchState,
	code: "NOT_YOUR_TURN" | "ILLEGAL_ACTION",
	message: string
): ActionResult {
	return { error: { code, message }, ok: false, state };
}

function validAmount(action: BettingAction, offered: LegalAction): boolean {
	if (action.type === "bet" || action.type === "raise") {
		return (
			action.totalTo !== undefined &&
			Number.isSafeInteger(action.totalTo) &&
			action.totalTo >= (offered.minTotalTo as number) &&
			action.totalTo <= (offered.maxTotalTo as number)
		);
	}
	if (action.type === "allin") {
		return (
			action.totalTo === undefined || action.totalTo === offered.maxTotalTo
		);
	}
	return action.totalTo === undefined;
}

/** All validation precedes construction: rejections return the original state. */
export function applyAction(
	state: MatchState,
	seatIndex: number,
	action: BettingAction
): ActionResult {
	const seat = state.public.seats[seatIndex];
	if (
		!Number.isInteger(seatIndex) ||
		state.public.actor !== seatIndex ||
		!seat ||
		!canAct(seat)
	) {
		return reject(state, "NOT_YOUR_TURN", "Only the current actor may act");
	}
	const legal = legalActions(state, seatIndex);
	const offered = legal.actions.find(
		(candidate) => candidate.type === action.type
	);
	if (!(offered && validAmount(action, offered))) {
		return reject(
			state,
			"ILLEGAL_ACTION",
			"Action or total street wager is illegal"
		);
	}
	let paid = 0;
	if (action.type === "call") {
		paid = legal.callAmount;
	} else if (action.type === "allin") {
		paid = seat.stack;
	} else if (action.type === "bet" || action.type === "raise") {
		paid = (action.totalTo as number) - seat.streetContribution;
	}
	const total = seat.streetContribution + paid;
	const currentBet = Math.max(state.public.currentBet, total);
	const increment = currentBet - state.public.currentBet;
	const fullRaise = increment >= state.public.lastFullRaiseIncrement;
	const next: MatchState = {
		...state,
		public: {
			...state.public,
			currentBet,
			lastFullRaiseIncrement: fullRaise
				? increment
				: state.public.lastFullRaiseIncrement,
			seats: state.public.seats.map((other, index) => {
				if (index !== seatIndex) {
					return fullRaise ? { ...other, actedThisRound: false } : { ...other };
				}
				return {
					...other,
					actedThisRound: true,
					allIn: other.stack === paid,
					folded: action.type === "fold",
					handContribution: other.handContribution + paid,
					lastActedBet: currentBet,
					stack: other.stack - paid,
					streetContribution: total,
				};
			}),
		},
	};
	const withRights: MatchState = {
		...next,
		public: {
			...next.public,
			seats: next.public.seats.map((other) => ({
				...other,
				raiseAllowed: canAct(other) && hasRaiseRight(next, other),
			})),
		},
	};
	return { ok: true, state: progressBetting(withRights, seatIndex) };
}
