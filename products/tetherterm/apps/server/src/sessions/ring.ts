import { TerminalError } from "../errors";

export const OUTPUT_RING_CAPACITY = 1024 * 1024;
export const MAX_READ_BYTES = 64 * 1024;
const INGEST_CHUNK_BYTES = 16 * 1024;
const decimalCursor = /^(0|[1-9][0-9]*)(?![\s\S])/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export interface OutputRingRead {
	gap: boolean;
	headCursor: string;
	nextCursor: string;
	oldestCursor: string;
	output: string;
}

/**
 * Fixed-size normalized UTF-8 ring, independent of PTYs, clocks and lifecycle.
 * Streaming replacement decoding withholds incomplete input (at most 3 bytes).
 * Only re-encoded complete characters enter storage; all offsets count these
 * normalized bytes. Markers hold character lengths (1–4), zero for interiors.
 */
export class OutputRing {
	private readonly bytes = new Uint8Array(OUTPUT_RING_CAPACITY);
	private readonly units = new Uint8Array(OUTPUT_RING_CAPACITY);
	private readonly ingest = new TextDecoder("utf-8", { ignoreBOM: true });
	private head = 0n;
	private oldest = 0n;
	private writeIndex = 0;
	// biome-ignore lint/style/noInferrableTypes: Explicit widening avoids Biome treating this mutable class flag as always false across methods.
	private finished: boolean = false;

	get headCursor(): string {
		return this.head.toString();
	}

	get oldestCursor(): string {
		return this.oldest.toString();
	}

	/** Complete normalized UTF-8 payload, never more than one MiB. */
	get retainedBytes(): number {
		return Number(this.head - this.oldest);
	}

	append(chunk: Uint8Array): void {
		if (this.finished) {
			throw new Error("Cannot append output after PTY EOF");
		}
		// Bound transient decoding/re-encoding even for a single oversized append.
		for (let start = 0; start < chunk.byteLength; start += INGEST_CHUNK_BYTES) {
			this.store(
				this.ingest.decode(chunk.subarray(start, start + INGEST_CHUNK_BYTES), {
					stream: true,
				})
			);
		}
	}

	/** Call only at PTY EOF, after final data; flush one truncated suffix once. */
	finish(): void {
		if (this.finished) {
			return;
		}
		this.finished = true;
		this.store(this.ingest.decode());
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
		if (start !== this.head && this.units[index] === 0) {
			throw new TerminalError(
				"BAD_CURSOR",
				"Cursor is not a character boundary"
			);
		}
		let length = 0;
		const available = Number(this.head - start);
		while (length < available) {
			const unit = this.units[index] ?? 0;
			if (unit === 0 || length + unit > limit) {
				break;
			}
			length += unit;
			index = (index + unit) % OUTPUT_RING_CAPACITY;
		}
		const result = new Uint8Array(length);
		const begin = this.indexOf(start);
		const firstLength = Math.min(length, OUTPUT_RING_CAPACITY - begin);
		result.set(this.bytes.subarray(begin, begin + firstLength));
		result.set(this.bytes.subarray(0, length - firstLength), firstLength);
		return {
			gap,
			headCursor: this.headCursor,
			nextCursor: (start + BigInt(length)).toString(),
			oldestCursor: this.oldestCursor,
			output: decoder.decode(result),
		};
	}

	private store(text: string): void {
		const normalized = encoder.encode(text);
		for (let start = 0; start < normalized.byteLength; ) {
			const lead = normalized[start] ?? 0;
			let length = 1;
			if (lead >= 0xf0) {
				length = 4;
			} else if (lead >= 0xe0) {
				length = 3;
			} else if (lead >= 0x80) {
				length = 2;
			}
			for (let offset = 0; offset < length; offset += 1) {
				this.bytes[this.writeIndex] = normalized[start + offset] ?? 0;
				this.units[this.writeIndex] = offset === 0 ? length : 0;
				this.writeIndex = (this.writeIndex + 1) % OUTPUT_RING_CAPACITY;
			}
			start += length;
		}
		this.head += BigInt(normalized.byteLength);
		const minimum = this.head - BigInt(OUTPUT_RING_CAPACITY);
		if (minimum > this.oldest) {
			this.oldest = minimum;
			let index = this.indexOf(this.oldest);
			// At most three bytes: the first retained byte is always char-aligned.
			while (this.units[index] === 0) {
				this.oldest += 1n;
				index = (index + 1) % OUTPUT_RING_CAPACITY;
			}
		}
	}

	private indexOf(cursor: bigint): number {
		return Number(cursor % BigInt(OUTPUT_RING_CAPACITY));
	}

	private parseCursor(cursor: string): bigint {
		const head = this.headCursor;
		// Compare decimal strings first so huge input never reaches BigInt parsing.
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
}
