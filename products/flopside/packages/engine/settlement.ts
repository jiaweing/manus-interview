import {
	compareHands,
	evaluateBest,
	type HandRank,
} from "@flopside/engine/evaluator";
import type {
	ChipPayout,
	HandSettlement,
	MatchState,
	SeatSettlement,
	SettledPot,
} from "./state";

function checkedTotal(values: readonly number[]): number {
	let total = 0;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error("Chip amounts must be nonnegative safe integers");
		}
		total += value;
		if (!Number.isSafeInteger(total)) {
			throw new Error("Total chips must be a safe integer");
		}
	}
	return total;
}

function checkedCompletion(state: MatchState): {
	contenders: number[];
	reason: "folded" | "showdown";
} {
	const { actor, board, dealerIndex, handStatus, seats } = state.public;
	if (
		(handStatus !== "folded" && handStatus !== "showdown") ||
		actor !== null
	) {
		throw new Error("Only a finished, unsettled hand may be settled");
	}
	if (
		!Number.isInteger(dealerIndex) ||
		dealerIndex < 0 ||
		dealerIndex >= seats.length
	) {
		throw new Error("Dealer must be a seat index");
	}
	const contenders = seats.flatMap((seat, index) =>
		seat.inHand && !seat.folded ? [index] : []
	);
	const uncontested = handStatus === "folded";
	if (
		(uncontested && contenders.length !== 1) ||
		(!uncontested && contenders.length < 2)
	) {
		throw new Error("Hand status does not match its contenders");
	}
	if (!uncontested && board.length !== 5) {
		throw new Error("Contested settlement requires a five-card board");
	}
	return { contenders, reason: handStatus };
}

function refundUnmatched(original: readonly number[]): {
	contributions: number[];
	refunds: ChipPayout[];
} {
	const contributions = [...original];
	// ALL contributors count, including folded seats. A unique highest level is
	// uncalled only above the second-highest level; equal maxima have no refund.
	const descending = [...contributions].sort((a, b) => b - a);
	const highest = descending[0] ?? 0;
	const excess = highest - (descending[1] ?? 0);
	const refunds: ChipPayout[] = [];
	if (excess > 0) {
		const owner = contributions.indexOf(highest);
		contributions[owner] = highest - excess;
		refunds.push({ amount: excess, seatIndex: owner });
	}
	return { contributions, refunds };
}

function showdownRanks(
	state: MatchState,
	showdownSeats: readonly number[]
): ReadonlyMap<number, HandRank> {
	const ranks = new Map<number, HandRank>();
	// Fold wins pass an empty set, so absent hole cards never enter evaluation.
	// No evaluated ranks/bestFive are copied into the public result.
	for (const index of showdownSeats) {
		const holeCards = state.private.holeCards[index];
		if (holeCards?.length !== 2) {
			throw new Error("Showdown contenders require two hole cards");
		}
		ranks.set(index, evaluateBest([...holeCards, ...state.public.board]));
	}
	return ranks;
}

function clockwiseWinners(
	winners: readonly number[],
	dealerIndex: number,
	seatCount: number
): number[] {
	const ordered: number[] = [];
	for (let offset = 1; offset <= seatCount; offset += 1) {
		const index = (dealerIndex + offset) % seatCount;
		if (winners.includes(index)) {
			ordered.push(index);
		}
	}
	return ordered;
}

function bestSeats(
	eligible: readonly number[],
	ranks: ReadonlyMap<number, HandRank>
): number[] {
	let best: HandRank | undefined;
	let winners: number[] = [];
	for (const index of eligible) {
		const rank = ranks.get(index);
		if (!rank) {
			throw new Error("Missing showdown hand");
		}
		const comparison = best ? compareHands(rank, best) : 1;
		if (comparison > 0) {
			best = rank;
			winners = [index];
		} else if (comparison === 0) {
			winners.push(index);
		}
	}
	return winners;
}

function constructPots(
	contributions: readonly number[],
	contenders: readonly number[],
	ranks: ReadonlyMap<number, HandRank>,
	dealerIndex: number
): SettledPot[] {
	const levels = [...new Set(contributions.filter((value) => value > 0))].sort(
		(a, b) => a - b
	);
	const pots: SettledPot[] = [];
	let previousLevel = 0;
	for (const level of levels) {
		const contributors = contributions.flatMap((value, index) =>
			value >= level ? [index] : []
		);
		const eligible = contributors.filter((index) => contenders.includes(index));
		if (eligible.length === 0) {
			throw new Error("A pot must have an eligible contender");
		}
		const amount = (level - previousLevel) * contributors.length;
		const winners = clockwiseWinners(
			eligible.length === 1 ? eligible : bestSeats(eligible, ranks),
			dealerIndex,
			contributions.length
		);
		const share = Math.floor(amount / winners.length);
		const remainder = amount % winners.length;
		const payouts = winners.map((seatIndex, order) => ({
			amount: share + (order < remainder ? 1 : 0),
			seatIndex,
		}));
		if (checkedTotal(payouts.map((payout) => payout.amount)) !== amount) {
			throw new Error("Pot payouts must conserve chips");
		}
		pots.push({
			amount,
			contributionLevel: level,
			contributorSeatIndices: contributors,
			eligibleSeatIndices: eligible,
			payouts,
			winnerSeatIndices: winners,
		});
		previousLevel = level;
	}
	return pots;
}

/**
 * Settle only a completed betting hand. No runout here: progressBetting already
 * deals contested all-ins to river; an unfinished/partial showdown is rejected.
 * Returns fresh public accounting; never mutates or exposes private cards.
 * Each pot's remainder goes one chip per winner clockwise left of the dealer.
 */
export function settleHand(state: MatchState): MatchState {
	const { contenders, reason } = checkedCompletion(state);
	const { seats } = state.public;
	const totalChips = checkedTotal(
		seats.flatMap((seat) => [seat.stack, seat.handContribution])
	);
	const original = seats.map((seat) => seat.handContribution);
	const { contributions, refunds } = refundUnmatched(original);
	const showdownSeatIndices = reason === "folded" ? [] : contenders;
	const ranks = showdownRanks(state, showdownSeatIndices);
	const pots = constructPots(
		contributions,
		contenders,
		ranks,
		state.public.dealerIndex
	);
	const accounting: SeatSettlement[] = seats.map((seat, seatIndex) => ({
		contribution: seat.handContribution,
		finalStack: seat.stack,
		netPayout: -seat.handContribution,
		payout: 0,
		refund: 0,
		seatIndex,
	}));
	for (const refund of refunds) {
		const account = accounting[refund.seatIndex] as SeatSettlement;
		account.refund += refund.amount;
	}
	for (const payout of pots.flatMap((pot) => pot.payouts)) {
		const account = accounting[payout.seatIndex] as SeatSettlement;
		account.payout += payout.amount;
	}
	for (const account of accounting) {
		account.finalStack += account.refund + account.payout;
		account.netPayout += account.refund + account.payout;
	}
	const totalPot = checkedTotal(pots.map((pot) => pot.amount));
	if (
		checkedTotal(accounting.map((account) => account.finalStack)) !==
			totalChips ||
		totalPot + checkedTotal(refunds.map((refund) => refund.amount)) !==
			checkedTotal(original)
	) {
		throw new Error("Settlement must conserve total chips");
	}
	const settlement: HandSettlement = {
		pots,
		reason,
		refunds,
		seats: accounting,
		showdownSeatIndices,
		totalChips,
		totalPot,
	};
	return {
		...state,
		public: {
			...state.public,
			actor: null,
			currentBet: 0,
			handStatus: "settled",
			seats: seats.map((seat, index) => ({
				...seat,
				handContribution: 0,
				raiseAllowed: false,
				stack: (accounting[index] as SeatSettlement).finalStack,
				streetContribution: 0,
			})),
			settlement,
		},
	};
}
