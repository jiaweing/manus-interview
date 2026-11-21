import { type Card, cardCode, RANKS, SUITS } from "./cards";
import { type DeckSource, productionDeck } from "./shuffle";
import {
	BLINDS,
	type MatchState,
	type SeatInput,
	type SeatState,
	STARTING_STACK,
	type Street,
} from "./state";

function nextSeat(
	seats: readonly SeatState[],
	afterIndex: number,
	eligible: (seat: SeatState) => boolean
): number | null {
	for (let offset = 1; offset <= seats.length; offset += 1) {
		const index = (afterIndex + offset) % seats.length;
		const seat = seats[index];
		if (seat && eligible(seat)) {
			return index;
		}
	}
	return null;
}

/** Circular order only; #31 must decide whether a betting round is complete. */
export function nextActor(
	state: MatchState,
	afterIndex: number = state.public.actor ?? state.public.dealerIndex
): number | null {
	if (
		!Number.isInteger(afterIndex) ||
		afterIndex < 0 ||
		afterIndex >= state.public.seats.length
	) {
		throw new RangeError("Actor anchor must be a seat index");
	}
	return nextSeat(
		state.public.seats,
		afterIndex,
		(seat) => seat.inHand && !seat.folded && !seat.allIn && seat.stack > 0
	);
}

function checkedDeck(source: DeckSource): Card[] {
	const deck = source();
	if (
		deck.length !== 52 ||
		deck.some(
			(card) => !(RANKS.includes(card.rank) && SUITS.includes(card.suit))
		) ||
		new Set(deck.map(cardCode)).size !== 52
	) {
		throw new Error("Deck source must supply a complete 52-card permutation");
	}
	return deck.map((card) => ({ ...card }));
}

function postBlind(seat: SeatState, amount: number): SeatState {
	const posted = Math.min(seat.stack, amount);
	return {
		...seat,
		allIn: seat.stack === posted,
		handContribution: posted,
		stack: seat.stack - posted,
		streetContribution: posted,
	};
}

function beginHand(
	previousSeats: readonly SeatState[],
	dealerIndex: number,
	handNumber: number,
	source: DeckSource
): MatchState {
	const seats = previousSeats.map((seat) => {
		if (!Number.isSafeInteger(seat.stack) || seat.stack < 0) {
			throw new Error("Seat stacks must be nonnegative safe integers");
		}
		return {
			...seat,
			allIn: false,
			folded: false,
			handContribution: 0,
			inHand: seat.stack > 0,
			streetContribution: 0,
		};
	});
	const activeCount = seats.filter((seat) => seat.inHand).length;
	if (activeCount < 2) {
		throw new Error("At least two funded seats are required for a hand");
	}
	const inHand = (seat: SeatState) => seat.inHand;
	const smallBlindIndex =
		activeCount === 2
			? dealerIndex
			: (nextSeat(seats, dealerIndex, inHand) as number);
	const bigBlindIndex = nextSeat(seats, smallBlindIndex, inHand) as number;
	const deck = checkedDeck(source);
	const holeCards: Card[][] = seats.map(() => []);
	let nextCardIndex = 0;
	// No burns. Deal one card at a time, clockwise left of dealer, twice.
	for (let round = 0; round < 2; round += 1) {
		let seatIndex = dealerIndex;
		for (let dealt = 0; dealt < activeCount; dealt += 1) {
			seatIndex = nextSeat(seats, seatIndex, inHand) as number;
			holeCards[seatIndex]?.push(deck[nextCardIndex] as Card);
			nextCardIndex += 1;
		}
	}
	seats[smallBlindIndex] = postBlind(
		seats[smallBlindIndex] as SeatState,
		BLINDS.small
	);
	seats[bigBlindIndex] = postBlind(
		seats[bigBlindIndex] as SeatState,
		BLINDS.big
	);
	const state: MatchState = {
		private: { deck, holeCards, nextCardIndex },
		public: {
			actor: null,
			bigBlindIndex,
			blinds: { ...BLINDS },
			board: [],
			dealerIndex,
			handNumber,
			seats,
			smallBlindIndex,
			street: "preflop",
		},
	};
	state.public.actor = nextActor(state, bigBlindIndex);
	return state;
}

/** Starts and deals hand 1, allocating 200 chips before the 5/10 blind posts. */
export function startMatch(
	seats: readonly SeatInput[],
	deckSource: DeckSource = productionDeck
): MatchState {
	if (seats.length < 2 || seats.length > 4) {
		throw new Error("A match requires two to four seats");
	}
	if (
		seats.some((seat) => !seat.id.trim()) ||
		new Set(seats.map((seat) => seat.id)).size !== seats.length
	) {
		throw new Error("Seat IDs must be nonempty and unique");
	}
	return beginHand(
		seats.map((seat) => ({
			allIn: false,
			folded: false,
			handContribution: 0,
			id: seat.id,
			inHand: true,
			stack: STARTING_STACK,
			streetContribution: 0,
		})),
		0,
		1,
		deckSource
	);
}

/** Caller must settle/refund the previous hand first; this never awards chips. */
export function startNextHand(
	state: MatchState,
	deckSource: DeckSource = productionDeck
): MatchState {
	const dealerIndex = nextSeat(
		state.public.seats,
		state.public.dealerIndex,
		(seat) => seat.stack > 0
	);
	if (dealerIndex === null) {
		throw new Error("At least two funded seats are required for a hand");
	}
	return beginHand(
		state.public.seats,
		dealerIndex,
		state.public.handNumber + 1,
		deckSource
	);
}

const NEXT_STREET: Record<Exclude<Street, "river">, Street> = {
	flop: "turn",
	preflop: "flop",
	turn: "river",
};

/** Called after #31 closes a betting round, or repeatedly for an all-in runout. */
export function advanceStreet(state: MatchState): MatchState {
	if (state.public.street === "river") {
		throw new Error("River is the final street; settle the hand instead");
	}
	const street = NEXT_STREET[state.public.street];
	const count = street === "flop" ? 3 : 1;
	const start = state.private.nextCardIndex;
	const drawn = state.private.deck.slice(start, start + count);
	if (drawn.length !== count) {
		throw new Error("Deck exhausted");
	}
	const next: MatchState = {
		private: { ...state.private, nextCardIndex: start + count },
		public: {
			...state.public,
			actor: null,
			board: [...state.public.board, ...drawn],
			seats: state.public.seats.map((seat) => ({
				...seat,
				streetContribution: 0,
			})),
			street,
		},
	};
	next.public.actor = nextActor(next, next.public.dealerIndex);
	return next;
}
