import { webcrypto } from "node:crypto";
import { type Card, fullDeck } from "./cards";

const UINT32_RANGE = 2 ** 32;
export type Uint32Source = () => number;
/** Fixtures can be passed by the caller only; there is no environment switch. */
export type DeckSource = () => readonly Card[];

/** node:crypto keeps the production entropy source server-only. */
export function cryptoUint32(): number {
	const sample = new Uint32Array(1);
	webcrypto.getRandomValues(sample);
	return sample[0] as number;
}

/** Uniform integer in [0, bound); reject the incomplete modulo bucket. */
export function boundedIndex(
	bound: number,
	source: Uint32Source = cryptoUint32
): number {
	if (!Number.isInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
		throw new RangeError("Bound must be an integer in [1, 2^32]");
	}
	const limit = UINT32_RANGE - (UINT32_RANGE % bound);
	for (;;) {
		const sample = source();
		if (!Number.isInteger(sample) || sample < 0 || sample >= UINT32_RANGE) {
			throw new RangeError("Entropy source must return a uint32");
		}
		if (sample < limit) {
			return sample % bound;
		}
	}
}

/** Fisher–Yates on a copy; injected entropy is useful for focused unit tests. */
export function shuffleDeck(
	deck: readonly Card[],
	source: Uint32Source = cryptoUint32
): Card[] {
	const result = [...deck];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const other = boundedIndex(index + 1, source);
		const currentCard = result[index] as Card;
		result[index] = result[other] as Card;
		result[other] = currentCard;
	}
	return result;
}

/** Default server deck source; no test fixture/configuration lookup occurs. */
export function productionDeck(): Card[] {
	return shuffleDeck(fullDeck());
}
