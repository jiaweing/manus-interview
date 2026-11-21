import { progressBetting } from "./betting";
import {
	assignDeadline,
	type ExpirationResult,
	expireTurn,
	type TurnDeadline,
} from "./deadline";
import { startMatch, startNextHand } from "./dealing";
import { settleHand } from "./settlement";
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

/** Lifecycle-managed hand 1, normalized and timed using the injected room clock. */
export function startLifecycleMatchAt(
	seats: readonly SeatInput[],
	nowMs: number,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator
): MatchState {
	return advanceMatchAt(
		startLifecycleMatch(seats, deckSource, newIds),
		nowMs,
		deckSource,
		newIds
	);
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

/**
 * Drain completed hands before publishing: settle once, decide lifecycle, deal
 * once, and repeat blind-only runouts. At most ten hand boundaries are visited.
 * Returns a final public result with turn:null or a live actor with a deadline.
 * Existing live deadlines are preserved; newly dealt hands start turnId at 1.
 * Never use startNextHandAt on lifecycle-managed state (it drops managed IDs).
 */
export function advanceMatchAt(
	state: MatchState,
	nowMs: number,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator,
	connectedSeatIds?: ReadonlySet<string>
): MatchState {
	// Also validates the injected clock, including on completed-state no-ops.
	let current = assignDeadline(state, nowMs);
	for (let boundary = 0; boundary < MAX_HANDS; boundary += 1) {
		if (current.public.result) {
			return current;
		}
		if (current.public.handStatus === "playing") {
			if (current.public.turn) {
				return current;
			}
			current = progressBetting(current);
			if (current.public.handStatus === "playing") {
				const timed = assignDeadline(current, nowMs);
				if (!timed.public.turn) {
					throw new Error(
						"Lifecycle requires a live timed actor or completed hand"
					);
				}
				return timed;
			}
		}
		if (current.public.handStatus !== "settled") {
			current = settleHand(current);
		}
		// Clear the completed turn before dealing, preserving IDs but resetting the
		// next hand's within-hand timer identity. Never settle an already-settled hand.
		current = advanceMatch(
			assignDeadline(current, nowMs),
			deckSource,
			newIds,
			connectedSeatIds
		);
	}
	if (current.public.result) {
		return assignDeadline(current, nowMs);
	}
	throw new Error("Lifecycle drain exceeded the ten-hand match limit");
}

/**
 * Queue callback composition. Early/stale callbacks remain exact identity
 * no-ops, invoking no deck/ID sources. Room/match-generation fencing is #38's job.
 */
export function expireTurnAndAdvanceAt(
	state: MatchState,
	capturedTurn: TurnDeadline,
	nowMs: number,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator,
	connectedSeatIds?: ReadonlySet<string>
): ExpirationResult {
	const expired = expireTurn(state, capturedTurn, nowMs);
	return expired.expired
		? {
				expired: true,
				state: advanceMatchAt(
					expired.state,
					nowMs,
					deckSource,
					newIds,
					connectedSeatIds
				),
			}
		: expired;
}

function reject(state: MatchState, message: string): RematchResult {
	return { error: { code: "ILLEGAL_ACTION", message }, ok: false, state };
}

/**
 * Only finished matches can rematch. The room supplies its authoritative
 * connected roster in room-seat order, including returning lobby reservations.
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
		!connectedSeatIds.has(requesterSeatId)
	) {
		return reject(state, "Only the connected host may rematch");
	}
	const seats = [...connectedSeatIds].map((id) => ({ id }));
	if (
		seats.length < 2 ||
		seats.length > 4 ||
		seats.some((seat) => !seat.id.trim())
	) {
		return reject(
			state,
			"A rematch requires two to four valid connected seats"
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
	const fresh = progressBetting(startMatch(seats, deckSource));
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

/** Same authorization/reset contract as rematch, with a drained timed new match. */
export function rematchAt(
	state: MatchState,
	requesterSeatId: string,
	hostSeatId: string,
	connectedSeatIds: ReadonlySet<string>,
	nowMs: number,
	deckSource: DeckSource | undefined,
	newIds: IdGenerator
): RematchResult {
	const result = rematch(
		state,
		requesterSeatId,
		hostSeatId,
		connectedSeatIds,
		deckSource,
		newIds
	);
	return result.ok
		? {
				ok: true,
				state: advanceMatchAt(
					result.state,
					nowMs,
					deckSource,
					newIds,
					connectedSeatIds
				),
			}
		: result;
}
