import { TerminalError } from "../errors";

export const OUTPUT_RING_CAPACITY = 1024 * 1024;
export const MAX_READ_BYTES = 64 * 1024;
const decimalCursor = /^(0|[1-9][0-9]*)(?![\s\S])/;
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const REPLACEMENT_FLAG = 8;

export interface OutputRingRead {
	gap: boolean;
	headCursor: string;
	nextCursor: string;
	oldestCursor: string;
	output: string;
}

/**
 * Fixed-size raw-byte ring, independent of PTYs, clocks and session lifecycle.
 * Unit markers hold UTF-8 character lengths (1–4), or 8 + the raw length of an
 * invalid maximal subpart displayed as U+FFFD. Zero denotes an interior byte
 * or a still-incomplete character. Cursors always count raw bytes, including
 * invalid bytes; the read budget always counts encoded returned text bytes.
 */
export class OutputRing {
	private readonly bytes = new Uint8Array(OUTPUT_RING_CAPACITY);
	private readonly units = new Uint8Array(OUTPUT_RING_CAPACITY);
	private head = 0n;
	private oldest = 0n;
	private writeIndex = 0;
	private pendingIndex = 0;
	private pendingLength = 0;
	private expectedLength = 0;
	private secondMin = 0x80;
	private secondMax = 0xbf;

	get headCursor(): string {
		return this.head.toString();
	}

	get oldestCursor(): string {
		return this.oldest.toString();
	}

	/** Includes an incomplete suffix, never more than one MiB of raw payload. */
	get retainedBytes(): number {
		return Number(this.head - this.oldest);
	}

	append(chunk: Uint8Array): void {
		for (const byte of chunk) {
			this.bytes[this.writeIndex] = byte;
			this.units[this.writeIndex] = 0;
			this.acceptByte(byte, this.writeIndex);
			this.writeIndex = (this.writeIndex + 1) % OUTPUT_RING_CAPACITY;
		}
		this.head += BigInt(chunk.byteLength);
		const minimum = this.head - BigInt(OUTPUT_RING_CAPACITY);
		if (minimum > this.oldest) {
			this.oldest = minimum;
			let index = this.indexOf(this.oldest);
			// At most three bytes: eviction always starts at a whole character.
			while (
				this.units[index] === 0 &&
				!(this.pendingLength > 0 && index === this.pendingIndex)
			) {
				this.oldest += 1n;
				index = (index + 1) % OUTPUT_RING_CAPACITY;
			}
		}
	}

	/** Call only after final PTY data has drained; flush a truncated suffix. */
	finish(): void {
		if (this.pendingLength > 0) {
			this.units[this.pendingIndex] = REPLACEMENT_FLAG + this.pendingLength;
			this.pendingLength = 0;
		}
	}

	/** Synchronous, non-consuming read. A too-small budget returns no progress. */
	read(cursor: string, maxBytes = MAX_READ_BYTES): OutputRingRead {
		const requested = this.parseCursor(cursor);
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
			throw new TerminalError(
				"LIMIT",
				"maxBytes must be a positive safe integer"
			);
		}
		const limit = Math.min(maxBytes, MAX_READ_BYTES);
		const gap = requested < this.oldest;
		const start = gap ? this.oldest : requested;
		let index = this.indexOf(start);
		const pendingStart = this.head - BigInt(this.pendingLength);
		if (
			start !== this.head &&
			this.units[index] === 0 &&
			!(this.pendingLength > 0 && start === pendingStart)
		) {
			throw new TerminalError(
				"BAD_CURSOR",
				"Cursor is not a character boundary"
			);
		}
		let rawLength = 0;
		let encodedLength = 0;
		const available = Number(this.head - start);
		while (rawLength < available) {
			const unit = this.units[index] ?? 0;
			if (unit === 0) {
				break;
			}
			const length = unit > REPLACEMENT_FLAG ? unit - REPLACEMENT_FLAG : unit;
			const encoded = unit > REPLACEMENT_FLAG ? 3 : length;
			if (encodedLength + encoded > limit) {
				break;
			}
			rawLength += length;
			encodedLength += encoded;
			index = (index + length) % OUTPUT_RING_CAPACITY;
		}
		const raw = new Uint8Array(rawLength);
		const begin = this.indexOf(start);
		const firstLength = Math.min(rawLength, OUTPUT_RING_CAPACITY - begin);
		raw.set(this.bytes.subarray(begin, begin + firstLength));
		raw.set(this.bytes.subarray(0, rawLength - firstLength), firstLength);
		return {
			gap,
			headCursor: this.headCursor,
			nextCursor: (start + BigInt(rawLength)).toString(),
			oldestCursor: this.oldestCursor,
			output: decoder.decode(raw),
		};
	}

	private indexOf(cursor: bigint): number {
		return Number(cursor % BigInt(OUTPUT_RING_CAPACITY));
	}

	private parseCursor(cursor: string): bigint {
		const head = this.headCursor;
		// Compare decimal strings first, so arbitrarily huge input never reaches
		// BigInt parsing. Accept canonical nonnegative decimal strings only.
		if (
			typeof cursor !== "string" ||
			!decimalCursor.test(cursor) ||
			cursor.length > head.length ||
			(cursor.length === head.length && cursor > head)
		) {
			throw new TerminalError(
				"BAD_CURSOR",
				"Cursor must be a decimal byte offset at or before head"
			);
		}
		return BigInt(cursor);
	}

	private acceptByte(byte: number, index: number): void {
		if (this.pendingLength > 0 && this.acceptContinuation(byte)) {
			return;
		}
		if (byte <= 0x7f) {
			this.units[index] = 1;
			return;
		}
		if (byte < 0xc2 || byte > 0xf4) {
			this.units[index] = REPLACEMENT_FLAG + 1;
			return;
		}
		this.pendingIndex = index;
		this.pendingLength = 1;
		this.configurePrefix(byte);
	}

	private acceptContinuation(byte: number): boolean {
		const min = this.pendingLength === 1 ? this.secondMin : 0x80;
		const max = this.pendingLength === 1 ? this.secondMax : 0xbf;
		if (byte < min || byte > max) {
			this.finish();
			return false;
		}
		this.pendingLength += 1;
		if (this.pendingLength === this.expectedLength) {
			this.units[this.pendingIndex] = this.pendingLength;
			this.pendingLength = 0;
		}
		return true;
	}

	private configurePrefix(byte: number): void {
		this.expectedLength = 4;
		if (byte <= 0xdf) {
			this.expectedLength = 2;
		} else if (byte <= 0xef) {
			this.expectedLength = 3;
		}
		this.secondMin = 0x80;
		this.secondMax = 0xbf;
		switch (byte) {
			case 0xe0:
				this.secondMin = 0xa0;
				break;
			case 0xf0:
				this.secondMin = 0x90;
				break;
			case 0xed:
				this.secondMax = 0x9f;
				break;
			case 0xf4:
				this.secondMax = 0x8f;
				break;
			default:
				break;
		}
	}
}
