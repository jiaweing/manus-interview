import {
	type ActionResult,
	applyAction,
	type BettingAction,
	legalActions,
	progressBetting,
} from "./betting";
import { advanceStreet, startMatch, startNextHand } from "./dealing";
import { settleHand } from "./settlement";
import type { DeckSource } from "./shuffle";
import type { MatchState, SeatInput, Street } from "./state";

export const TURN_MS = 12_000;

/** Public, serializable timer identity. The room also fences its match generation. */
export interface TurnDeadline {
	actorIndex: number;
	deadlineAt: number;
	handNumber: number;
	street: Street;
	/** Monotonically increasing within a hand, including repeated actors. */
	turnId: number;
}

export interface ExpirationResult {
	expired: boolean;
	state: MatchState;
}

function checkedNow(nowMs: number): void {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
		throw new RangeError(
			"Clock must supply nonnegative safe-integer milliseconds"
		);
	}
}

function identifiesActor(state: MatchState, turn: TurnDeadline): boolean {
	return (
		state.public.handStatus === "playing" &&
		state.public.actor === turn.actorIndex &&
		state.public.handNumber === turn.handNumber &&
		state.public.street === turn.street
	);
}

function deadlineFor(
	state: MatchState,
	nowMs: number,
	previous: TurnDeadline | null | undefined,
	newTurn: boolean
): MatchState {
	checkedNow(nowMs);
	const { actor } = state.public;
	if (
		actor === null ||
		!legalActions(state, actor).actions.some((action) => action.type === "fold")
	) {
		return state.public.turn === null
			? state
			: { ...state, public: { ...state.public, turn: null } };
	}
	if (!newTurn && previous && identifiesActor(state, previous)) {
		return state;
	}
	const turnId = (previous?.turnId ?? 0) + 1;
	const deadlineAt = nowMs + TURN_MS;
	if (!(Number.isSafeInteger(deadlineAt) && Number.isSafeInteger(turnId))) {
		throw new RangeError("Deadline and turn identity must be safe integers");
	}
	return {
		...state,
		public: {
			...state.public,
			turn: {
				actorIndex: actor,
				deadlineAt,
				handNumber: state.public.handNumber,
				street: state.public.street,
				turnId,
			},
		},
	};
}

/**
 * Attach an initial deadline or preserve the existing actor/hand/street deadline.
 * View projection/resume may call this without extending a turn. Use the At
 * wrappers for actions, rather than mixing timed and legacy reducers.
 */
export function assignDeadline(state: MatchState, nowMs: number): MatchState {
	return deadlineFor(state, nowMs, state.public.turn, false);
}

function finishTransition(
	state: MatchState,
	nowMs: number,
	previous: TurnDeadline | null | undefined,
	newTurn = false
): MatchState {
	const ready =
		state.public.actor === null &&
		(state.public.handStatus === "folded" ||
			state.public.handStatus === "showdown");
	return deadlineFor(
		ready ? settleHand(state) : state,
		nowMs,
		previous,
		newTurn
	);
}

/** Normalize blind-only all-ins, settle if complete, otherwise time the actor. */
export function startMatchAt(
	seats: readonly SeatInput[],
	nowMs: number,
	deckSource?: DeckSource
): MatchState {
	checkedNow(nowMs);
	return finishTransition(
		progressBetting(startMatch(seats, deckSource)),
		nowMs,
		null
	);
}

/** Caller settles the preceding hand and decides lifecycle completion first. */
export function startNextHandAt(
	state: MatchState,
	nowMs: number,
	deckSource?: DeckSource
): MatchState {
	checkedNow(nowMs);
	return finishTransition(
		progressBetting(startNextHand(state, deckSource)),
		nowMs,
		null
	);
}

/** Idempotent normalization does not renew an unchanged turn. */
export function progressBettingAt(
	state: MatchState,
	nowMs: number,
	afterIndex?: number
): MatchState {
	checkedNow(nowMs);
	return finishTransition(
		progressBetting(state, afterIndex),
		nowMs,
		state.public.turn
	);
}

/** Lower-level street transition: caller must have closed the betting round. */
export function advanceStreetAt(state: MatchState, nowMs: number): MatchState {
	checkedNow(nowMs);
	return finishTransition(
		progressBetting(advanceStreet(state)),
		nowMs,
		state.public.turn,
		true
	);
}

/** Accepted actions progress/settle and time each new turn; rejections are no-ops. */
export function applyActionAt(
	state: MatchState,
	seatIndex: number,
	action: BettingAction,
	nowMs: number
): ActionResult {
	checkedNow(nowMs);
	const result = applyAction(state, seatIndex, action);
	return result.ok
		? {
				ok: true,
				state: finishTransition(result.state, nowMs, state.public.turn, true),
			}
		: result;
}

/**
 * Fire only the current captured timer at/after its deadline. Always FOLD, never
 * check. The next deadline is expiry's injected nowMs + TURN_MS, not the old
 * deadline + TURN_MS. No connection data, ambient clock, scheduling or I/O here.
 */
export function expireTurn(
	state: MatchState,
	captured: TurnDeadline,
	nowMs: number
): ExpirationResult {
	checkedNow(nowMs);
	const current = state.public.turn;
	if (
		!(current && identifiesActor(state, current)) ||
		captured.handNumber !== current.handNumber ||
		captured.actorIndex !== current.actorIndex ||
		captured.street !== current.street ||
		captured.turnId !== current.turnId ||
		captured.deadlineAt !== current.deadlineAt ||
		nowMs < current.deadlineAt
	) {
		return { expired: false, state };
	}
	const result = applyActionAt(
		state,
		current.actorIndex,
		{ type: "fold" },
		nowMs
	);
	return { expired: result.ok, state: result.state };
}
