import { progressBetting } from "./betting";
import { startMatch, startNextHand } from "./dealing";
import type { DeckSource } from "./shuffle";
import type { MatchState, SeatInput, SeatState } from "./state";

export const MAX_HANDS = 10;
export type TerminationReason =
	| "bust"
	| "hands_complete"
	| "seat_expired"
	| "abandoned";

/** Seat-ID-based, public accounting only. Arrays use engine roster order. */
export interface MatchResult {
	finalStacks: { seatId: string; stack: number }[];
	terminationReason: TerminationReason;
	winnerSeatIds: string[];
}

/** Server-owned generator; IDs must be fresh, nonempty, and never reused. */
export type IdGenerator = (kind: "match" | "hand") => string;

export type RematchResult =
	| { ok: true; state: MatchState }
	| {
			ok: false;
			state: MatchState;
			error: { code: "ILLEGAL_ACTION"; message: string };
	  };

function checkedId(
	newIds: IdGenerator,
	kind: "match" | "hand",
	previous: readonly (string | undefined)[]
): string {
	const id = newIds(kind);
	if (typeof id !== "string" || !id.trim() || previous.includes(id)) {
		throw new Error("Lifecycle identifiers must be nonempty and distinct");
	}
	return id;
}

/** Starts hand 1 with dealer 0 and 200 per seat BEFORE the existing blind posts. */
export function startLifecycleMatch(
	seats: readonly SeatInput[],
	deckSource: DeckSource | undefined,
	newIds: IdGenerator
): MatchState {
	const matchId = checkedId(newIds, "match", []);
	const handId = checkedId(newIds, "hand", [matchId]);
	const state = progressBetting(startMatch(seats, deckSource));
	return {
		...state,
		private: { ...state.private, pendingExpiryConnectedSeatIds: null },
		public: { ...state.public, handId, matchId, result: null },
	};
}

function connectedSeats(
	state: MatchState,
	connectedSeatIds: ReadonlySet<string>
): SeatState[] {
	return state.public.seats.filter((seat) => connectedSeatIds.has(seat.id));
}

/**
 * Records a copied connectivity snapshot, never folds/settles/aborts the hand.
 * Repeated requests refresh the snapshot. Finished matches are immutable no-ops.
 */
export function requestExpiryTermination(
	state: MatchState,
	connectedSeatIds: ReadonlySet<string>
): MatchState {
	if (state.public.result) {
		return state;
	}
	return {
		...state,
		private: {
			...state.private,
			pendingExpiryConnectedSeatIds: connectedSeats(
				state,
				connectedSeatIds
			).map((seat) => seat.id),
		},
	};
}

function finish(
	state: MatchState,
	eligible: readonly SeatState[],
	terminationReason: TerminationReason
): MatchState {
	const highest = Math.max(...eligible.map((seat) => seat.stack));
	const result: MatchResult = {
		finalStacks: state.public.seats.map((seat) => ({
			seatId: seat.id,
			stack: seat.stack,
		})),
		terminationReason,
		winnerSeatIds: eligible
			.filter((seat) => seat.stack === highest)
			.map((seat) => seat.id),
	};
	return { ...state, public: { ...state.public, result } };
}

/**
 * Run AFTER settleHand. Until then this is an identity no-op, even with expiry
 * pending or an all-in zero stack. A stored result is also an identity no-op.
 * Expiry takes precedence over bust/hand limit. Supply current connectivity at
 * this boundary to replace the request's snapshot when connections changed.
 */
export function advanceMatch(
	state: MatchState,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator,
	connectedSeatIds?: ReadonlySet<string>
): MatchState {
	if (state.public.result || state.public.handStatus !== "settled") {
		return state;
	}
	const { actor, handNumber, seats, settlement } = state.public;
	if (
		actor !== null ||
		!settlement ||
		!Number.isSafeInteger(handNumber) ||
		handNumber < 1 ||
		handNumber > MAX_HANDS ||
		seats.some(
			(seat) =>
				seat.handContribution !== 0 ||
				seat.streetContribution !== 0 ||
				!Number.isSafeInteger(seat.stack) ||
				seat.stack < 0
		)
	) {
		throw new Error(
			"Lifecycle requires a fully settled hand within the match limit"
		);
	}
	const pending = state.private.pendingExpiryConnectedSeatIds;
	if (pending !== undefined && pending !== null) {
		const eligible = connectedSeats(
			state,
			connectedSeatIds ?? new Set(pending)
		);
		return finish(
			state,
			eligible,
			eligible.length === 0 ? "abandoned" : "seat_expired"
		);
	}
	if (seats.some((seat) => seat.stack === 0)) {
		return finish(state, seats, "bust");
	}
	if (handNumber === MAX_HANDS) {
		return finish(state, seats, "hands_complete");
	}
	const handId = checkedId(newIds, "hand", [
		state.public.matchId,
		state.public.handId,
	]);
	// Preserve lifecycle/room metadata across dealing's lower-level fresh state.
	const next = startNextHand(state, deckSource);
	return progressBetting({
		...state,
		private: { ...state.private, ...next.private },
		public: { ...state.public, ...next.public, handId, result: null },
	});
}

function reject(state: MatchState, message: string): RematchResult {
	return { error: { code: "ILLEGAL_ACTION", message }, ok: false, state };
}

/**
 * Only finished matches can rematch. Connected IDs are intersected with the
 * locked engine roster; unknown IDs cannot become players or satisfy quorum.
 * Rejections never invoke deck/ID sources and return the exact original state.
 */
export function rematch(
	state: MatchState,
	requesterSeatId: string,
	hostSeatId: string,
	connectedSeatIds: ReadonlySet<string>,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator
): RematchResult {
	if (!state.public.result || state.public.handStatus !== "settled") {
		return reject(state, "Only a finished match may be rematched");
	}
	if (
		requesterSeatId !== hostSeatId ||
		!connectedSeatIds.has(requesterSeatId) ||
		!state.public.seats.some((seat) => seat.id === requesterSeatId)
	) {
		return reject(state, "Only the connected host may rematch");
	}
	const seats = connectedSeats(state, connectedSeatIds);
	if (seats.length < 2) {
		return reject(
			state,
			"A rematch requires at least two connected participants"
		);
	}
	const matchId = checkedId(newIds, "match", [
		state.public.matchId,
		state.public.handId,
	]);
	const handId = checkedId(newIds, "hand", [
		matchId,
		state.public.matchId,
		state.public.handId,
	]);
	const fresh = progressBetting(
		startMatch(
			seats.map((seat) => ({ id: seat.id })),
			deckSource
		)
	);
	// Room code is outside the engine. Preserve it if a caller attached it,
	// but never carry old hand/turn metadata into a reset public/private state.
	const roomCode =
		"roomCode" in state.public ? { roomCode: state.public.roomCode } : {};
	return {
		ok: true,
		state: {
			...state,
			private: { ...fresh.private, pendingExpiryConnectedSeatIds: null },
			public: { ...roomCode, ...fresh.public, handId, matchId, result: null },
		},
	};
}
