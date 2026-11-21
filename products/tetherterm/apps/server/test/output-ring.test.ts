import { describe, expect, test } from "bun:test";
import { TerminalError } from "../src/errors";
import {
	MAX_READ_BYTES,
	OUTPUT_RING_CAPACITY,
	OutputRing,
	type OutputRingRead,
} from "../src/sessions/ring";

const encoder = new TextEncoder();
const encode = (text: string) => encoder.encode(text);

function assertBounded(
	ring: OutputRing,
	result: OutputRingRead,
	cursor: string,
	budget = MAX_READ_BYTES
): void {
	expect(ring.retainedBytes).toBeLessThanOrEqual(1_048_576);
	expect(encode(result.output).byteLength).toBeLessThanOrEqual(
		Math.min(budget, 65_536)
	);
	const start = result.gap ? result.oldestCursor : cursor;
	expect(BigInt(result.nextCursor)).toBe(
		BigInt(start) + BigInt(encode(result.output).byteLength)
	);
	expect(BigInt(result.nextCursor)).toBeLessThanOrEqual(
		BigInt(result.headCursor)
	);
}

function drain(
	ring: OutputRing,
	initialCursor = "0",
	budget = MAX_READ_BYTES
): string {
	let cursor = initialCursor;
	const outputs: string[] = [];
	for (let reads = 0; reads < OUTPUT_RING_CAPACITY; reads += 1) {
		const result = ring.read(cursor, budget);
		assertBounded(ring, result, cursor, budget);
		outputs.push(result.output);
		if (result.nextCursor === result.headCursor) {
			return outputs.join("");
		}
		expect(result.nextCursor).not.toBe(cursor);
		cursor = result.nextCursor;
	}
	throw new Error("Read made no bounded progress");
}

function badCursor(ring: OutputRing, cursor: string): void {
	expect(() => ring.read(cursor)).toThrow(TerminalError);
	expect(() => ring.read(cursor)).toThrow(
		expect.objectContaining({ code: "BAD_CURSOR" })
	);
}

describe("incremental reads and exact UTF-8 byte cursors", () => {
	test("empty/quiet reads return synchronously with unchanged cursor", () => {
		const ring = new OutputRing();
		for (let index = 0; index < 100; index += 1) {
			const result = ring.read("0");
			expect(result).not.toBeInstanceOf(Promise);
			expect(result).toEqual({
				gap: false,
				headCursor: "0",
				nextCursor: "0",
				oldestCursor: "0",
				output: "",
			});
			assertBounded(ring, result, "0");
		}
	});

	test("incremental append/read returns no duplicates or loss", () => {
		const ring = new OutputRing();
		const pieces = [
			"hello",
			" é ",
			"漢字",
			"🙂",
			"\u001b[31mred\u001b[0m",
			"\n",
		];
		const outputs: string[] = [];
		let cursor = "0";
		for (const piece of pieces) {
			ring.append(encode(piece));
			const result = ring.read(cursor);
			assertBounded(ring, result, cursor);
			expect(result.output).toBe(piece);
			outputs.push(result.output);
			cursor = result.nextCursor;
			const quiet = ring.read(cursor);
			assertBounded(ring, quiet, cursor);
			expect(quiet.output).toBe("");
			expect(quiet.nextCursor).toBe(cursor);
		}
		expect(outputs.join("")).toBe(pieces.join(""));
		expect(cursor).toBe(String(encode(pieces.join("")).byteLength));
	});

	test("repeated reads are non-consuming snapshots", () => {
		const ring = new OutputRing();
		ring.append(encode("é🙂漢"));
		const first = ring.read("0", 6);
		expect(first.output).toBe("é🙂");
		assertBounded(ring, first, "0", 6);
		expect(ring.read("0", 6)).toEqual(first);
		expect(ring.read(first.nextCursor).output).toBe("漢");
	});

	test("BOM, NUL, CRLF and ANSI are preserved byte for byte", () => {
		const ring = new OutputRing();
		const text =
			"\ufeff\u0000\r\n\u001b[31;1mé🙂\u001b[0m\u001b]0;title\u0007\u001b[2J\u001b[H";
		for (const byte of encode(text)) {
			ring.append(new Uint8Array([byte]));
		}
		const result = ring.read("0");
		expect(encode(result.output)).toEqual(encode(text));
		assertBounded(ring, result, "0");
		expect(drain(ring, "0", 4)).toBe(text);
	});

	test("append copies caller bytes instead of retaining mutable chunks", () => {
		const ring = new OutputRing();
		const bytes = encode("🙂abc");
		ring.append(bytes);
		bytes.fill(0);
		expect(ring.read("0").output).toBe("🙂abc");
	});
});

describe("fragmented Unicode", () => {
	for (const character of ["é", "漢", "🙂", "𐀀", "\u{10ffff}"]) {
		const bytes = encode(character);
		for (let split = 1; split < bytes.byteLength; split += 1) {
			test(`${character} survives chunk split at byte ${split}`, () => {
				const ring = new OutputRing();
				ring.append(encode("x"));
				ring.append(bytes.subarray(0, split));
				const prefix = ring.read("0");
				expect(prefix.output).toBe("x");
				expect(prefix.nextCursor).toBe("1");
				expect(prefix.headCursor).toBe("1");
				assertBounded(ring, prefix, "0");
				const pending = ring.read("1");
				expect(pending.output).toBe("");
				expect(pending.nextCursor).toBe("1");
				expect(ring.read(pending.headCursor).output).toBe("");
				for (let offset = 2; offset < 1 + split; offset += 1) {
					badCursor(ring, String(offset));
				}
				ring.append(bytes.subarray(split));
				ring.append(encode("y"));
				const result = ring.read(prefix.nextCursor);
				expect(result.output).toBe(`${character}y`);
				assertBounded(ring, result, prefix.nextCursor);
				expect(drain(ring)).toBe(`x${character}y`);
			});
		}
	}

	test("one-byte chunks across many mixed Unicode characters", () => {
		const ring = new OutputRing();
		const text = "aé漢🙂\r\n".repeat(1000);
		let cursor = "0";
		const output: string[] = [];
		for (const byte of encode(text)) {
			ring.append(new Uint8Array([byte]));
			const result = ring.read(cursor, 4);
			assertBounded(ring, result, cursor, 4);
			output.push(result.output);
			cursor = result.nextCursor;
		}
		expect(output.join("")).toBe(text);
		expect(cursor).toBe(ring.headCursor);
	});
});

describe("bounded reads", () => {
	for (const character of ["é", "漢", "🙂"]) {
		for (
			let available = 1;
			available < encode(character).byteLength;
			available += 1
		) {
			test(`${character} crossing 64-KiB cap with ${available} bytes left`, () => {
				const ring = new OutputRing();
				const prefix = "a".repeat(MAX_READ_BYTES - available);
				ring.append(encode(`${prefix}${character}tail`));
				const first = ring.read("0", MAX_READ_BYTES * 4);
				expect(first.output).toBe(prefix);
				assertBounded(ring, first, "0", MAX_READ_BYTES * 4);
				const second = ring.read(first.nextCursor);
				expect(second.output).toBe(`${character}tail`);
				assertBounded(ring, second, first.nextCursor);
			});
		}
	}

	for (const budget of [1, 2, 3, 4, 5, 7, 32, MAX_READ_BYTES]) {
		test(`small byte budget ${budget} never splits or advances beyond text`, () => {
			const ring = new OutputRing();
			ring.append(encode("🙂é漢a"));
			const result = ring.read("0", budget);
			assertBounded(ring, result, "0", budget);
			if (budget < 4) {
				expect(result.output).toBe("");
				expect(result.nextCursor).toBe("0");
			} else {
				expect(result.output.startsWith("🙂")).toBe(true);
			}
		});
	}

	test("ASCII reads are capped exactly at 64 KiB and drain without loss", () => {
		const ring = new OutputRing();
		const text = "a".repeat(MAX_READ_BYTES * 3 + 17);
		ring.append(encode(text));
		const result = ring.read("0", Number.MAX_SAFE_INTEGER);
		expect(encode(result.output).byteLength).toBe(MAX_READ_BYTES);
		assertBounded(ring, result, "0", Number.MAX_SAFE_INTEGER);
		expect(drain(ring)).toBe(text);
	});

	for (const maxBytes of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		test(`invalid read budget ${maxBytes} returns LIMIT`, () => {
			expect(() => new OutputRing().read("0", maxBytes)).toThrow(
				expect.objectContaining({ code: "LIMIT" })
			);
		});
	}
});

describe("overflow and explicit gaps", () => {
	test("exactly one MiB survives; oldest/head/stale/future cursors are distinct", () => {
		const ring = new OutputRing();
		ring.append(encode("a".repeat(OUTPUT_RING_CAPACITY)));
		expect(ring.retainedBytes).toBe(OUTPUT_RING_CAPACITY);
		expect(ring.oldestCursor).toBe("0");
		expect(ring.read("0", 1).gap).toBe(false);
		ring.append(encode("b"));
		expect(ring.retainedBytes).toBe(OUTPUT_RING_CAPACITY);
		expect(ring.oldestCursor).toBe("1");
		const stale = ring.read("0", 1);
		expect(stale.gap).toBe(true);
		expect(stale.oldestCursor).toBe("1");
		assertBounded(ring, stale, "0", 1);
		const oldest = ring.read("1", 1);
		expect(oldest.gap).toBe(false);
		assertBounded(ring, oldest, "1", 1);
		const head = ring.read(ring.headCursor);
		expect(head.gap).toBe(false);
		expect(head.output).toBe("");
		assertBounded(ring, head, ring.headCursor);
		badCursor(ring, String(BigInt(ring.headCursor) + 1n));
		expect(drain(ring)).toBe(`${"a".repeat(OUTPUT_RING_CAPACITY - 1)}b`);
	});

	for (const character of ["é", "漢", "🙂"]) {
		for (let lost = 1; lost < encode(character).byteLength; lost += 1) {
			test(`overflow by ${lost} byte(s) evicts whole ${character}`, () => {
				const ring = new OutputRing();
				const width = encode(character).byteLength;
				ring.append(
					encode(`${character}${"a".repeat(OUTPUT_RING_CAPACITY - width)}`)
				);
				ring.append(encode("b".repeat(lost)));
				expect(ring.oldestCursor).toBe(String(width));
				expect(ring.retainedBytes).toBe(OUTPUT_RING_CAPACITY + lost - width);
				for (let cursor = 0; cursor < width; cursor += 1) {
					const result = ring.read(String(cursor), 1);
					expect(result.gap).toBe(true);
					assertBounded(ring, result, String(cursor), 1);
				}
				const oldest = ring.read(ring.oldestCursor, 1);
				expect(oldest.gap).toBe(false);
				assertBounded(ring, oldest, ring.oldestCursor, 1);
			});
		}
	}

	test("a single oversized chunk and repeated wraparound stay bounded", () => {
		const ring = new OutputRing();
		const text = "🙂漢éa".repeat(OUTPUT_RING_CAPACITY / 2);
		ring.append(encode(text));
		expect(ring.retainedBytes).toBeLessThanOrEqual(OUTPUT_RING_CAPACITY);
		expect(drain(ring)).toBe(
			new TextDecoder().decode(encode(text).subarray(Number(ring.oldestCursor)))
		);
		for (let run = 0; run < 3; run += 1) {
			ring.append(encode("🙂".repeat(OUTPUT_RING_CAPACITY / 4)));
			expect(ring.retainedBytes).toBe(OUTPUT_RING_CAPACITY);
			expect(drain(ring)).toBe("🙂".repeat(OUTPUT_RING_CAPACITY / 4));
		}
	});

	test("fragmented emoji crossing physical wrap survives eviction and completion", () => {
		const ring = new OutputRing();
		const emoji = encode("🙂");
		ring.append(encode("a".repeat(OUTPUT_RING_CAPACITY - 2)));
		ring.append(emoji.subarray(0, 3));
		const pendingCursor = String(OUTPUT_RING_CAPACITY - 2);
		const pending = ring.read(pendingCursor);
		expect(pending.output).toBe("");
		expect(pending.nextCursor).toBe(pendingCursor);
		badCursor(ring, String(OUTPUT_RING_CAPACITY - 1));
		ring.append(emoji.subarray(3));
		const result = ring.read(pendingCursor);
		expect(result.output).toBe("🙂");
		assertBounded(ring, result, pendingCursor);
		expect(ring.oldestCursor).toBe("2");
	});
});

describe("invalid cursors", () => {
	for (const cursor of [
		"",
		" ",
		"-1",
		"-0",
		"1.0",
		"1.5",
		"1e1",
		"+1",
		"01",
		"00",
		"0x1",
		"1\n",
		"NaN",
		"Infinity",
		"9007199254740993",
		"9".repeat(10_000),
	]) {
		test(`malformed/huge cursor ${cursor.slice(0, 24)} returns BAD_CURSOR`, () => {
			const ring = new OutputRing();
			ring.append(encode("a".repeat(1000)));
			badCursor(ring, cursor);
		});
	}

	test("non-string cursors are not coerced", () => {
		for (const cursor of [0, -1, 1.5, null, undefined, {}, 0n]) {
			badCursor(new OutputRing(), cursor as unknown as string);
		}
	});

	test("interior offsets of complete 2/3/4-byte characters are rejected", () => {
		const ring = new OutputRing();
		let start = 0;
		for (const character of ["é", "漢", "🙂"]) {
			ring.append(encode(character));
			for (
				let interior = 1;
				interior < encode(character).byteLength;
				interior += 1
			) {
				badCursor(ring, String(start + interior));
			}
			expect(ring.read(String(start)).output).toBe(character);
			start += encode(character).byteLength;
		}
	});
});

describe("invalid UTF-8: normalized replacement bytes and exact cursors", () => {
	for (const bytes of [
		[0xff],
		[0x80],
		[0xc0, 0xaf],
		[0xed, 0xa0, 0x80],
		[0xf4, 0x90, 0x80, 0x80],
		[0xe2, 0x82, 0x61],
		[0xf0, 0x9f, 0x61],
		[0xe0, 0x80, 0x61],
		[0xf0, 0x80, 0x80, 0x80],
	]) {
		test(`invalid sequence ${bytes.join(",")} matches standard replacement decoding`, () => {
			const ring = new OutputRing();
			const raw = new Uint8Array(bytes);
			for (const byte of raw) {
				ring.append(new Uint8Array([byte]));
			}
			ring.finish();
			const result = ring.read("0");
			expect(result.output).toBe(new TextDecoder().decode(raw));
			assertBounded(ring, result, "0");
			expect(result.nextCursor).toBe(String(encode(result.output).byteLength));
			expect(ring.retainedBytes).toBe(encode(result.output).byteLength);
		});
	}

	test("replacement expansion respects budgets and advances normalized bytes only", () => {
		const ring = new OutputRing();
		ring.append(new Uint8Array(MAX_READ_BYTES).fill(0xff));
		const stalled = ring.read("0", 2);
		expect(stalled.output).toBe("");
		expect(stalled.nextCursor).toBe("0");
		let cursor = "0";
		let replacements = 0;
		while (cursor !== ring.headCursor) {
			const result = ring.read(cursor);
			const { length } = result.output;
			expect(result.output).toBe("�".repeat(length));
			assertBounded(ring, result, cursor);
			expect(BigInt(result.nextCursor)).toBe(
				BigInt(cursor) + BigInt(length * 3)
			);
			expect(length).toBeGreaterThan(0);
			replacements += length;
			cursor = result.nextCursor;
		}
		expect(replacements).toBe(MAX_READ_BYTES);
	});

	test("replacement-expanding oversized input evicts only whole normalized characters", () => {
		const ring = new OutputRing();
		ring.append(new Uint8Array(OUTPUT_RING_CAPACITY + 1).fill(0xff));
		expect(ring.headCursor).toBe(String((OUTPUT_RING_CAPACITY + 1) * 3));
		expect(BigInt(ring.oldestCursor) % 3n).toBe(0n);
		expect(ring.retainedBytes).toBeLessThanOrEqual(OUTPUT_RING_CAPACITY);
		const result = ring.read("0", 4);
		expect(result.gap).toBe(true);
		expect(result.output).toBe("�");
		assertBounded(ring, result, "0", 4);
		badCursor(ring, String(BigInt(ring.oldestCursor) + 1n));
		badCursor(ring, String(BigInt(ring.oldestCursor) + 2n));
	});

	test("EOF replacement at full capacity evicts a complete leading multibyte character", () => {
		const ring = new OutputRing();
		ring.append(encode(`🙂${"a".repeat(OUTPUT_RING_CAPACITY - 4)}`));
		ring.append(new Uint8Array([0xf0, 0x9f]));
		expect(ring.retainedBytes).toBe(OUTPUT_RING_CAPACITY);
		ring.finish();
		expect(ring.oldestCursor).toBe("4");
		const result = ring.read("0", 1);
		expect(result.gap).toBe(true);
		expect(result.output).toBe("a");
		assertBounded(ring, result, "0", 1);
		const tailCursor = String(BigInt(ring.headCursor) - 3n);
		expect(ring.read(tailCursor, 3).output).toBe("�");
	});

	test("incomplete suffix is withheld until EOF, then one replacement adds three bytes exactly once", () => {
		const ring = new OutputRing();
		ring.append(new Uint8Array([0x61, 0xf0, 0x9f]));
		expect(ring.read("0").output).toBe("a");
		expect(ring.read("1").output).toBe("");
		expect(ring.headCursor).toBe("1");
		ring.finish();
		ring.finish();
		const result = ring.read("1", 3);
		expect(result.output).toBe("�");
		expect(result.nextCursor).toBe("4");
		assertBounded(ring, result, "1", 3);
		badCursor(ring, "2");
		badCursor(ring, "3");
		expect(() => ring.append(encode("late"))).toThrow("after PTY EOF");
	});
});

describe("differential fragmented/raw-byte coverage", () => {
	test("deterministic arbitrary bytes match standard decoding across chunks and budgets", () => {
		const ring = new OutputRing();
		const raw = new Uint8Array(8192);
		let seed = 107;
		for (let index = 0; index < raw.byteLength; index += 1) {
			seed = (seed * 48_271) % 2_147_483_647;
			raw[index] = seed % 256;
		}
		const standard = new TextDecoder("utf-8", { ignoreBOM: true });
		const normalized = encode(standard.decode(raw));
		let cursor = "0";
		const outputs: string[] = [];
		function readAvailable(budget: number): void {
			for (let count = 0; count <= raw.byteLength; count += 1) {
				const result = ring.read(cursor, budget);
				assertBounded(ring, result, cursor, budget);
				if (result.nextCursor === cursor) {
					expect(result.output).toBe("");
					return;
				}
				expect(result.output).toBe(
					standard.decode(
						normalized.subarray(Number(cursor), Number(result.nextCursor))
					)
				);
				expect(result.output.length).toBeGreaterThan(0);
				outputs.push(result.output);
				cursor = result.nextCursor;
			}
			throw new Error("Differential read failed to become quiet");
		}
		for (let begin = 0; begin < raw.byteLength; begin += 7) {
			ring.append(raw.subarray(begin, begin + 7));
			readAvailable(4);
			readAvailable(13);
			expect(ring.retainedBytes).toBeLessThanOrEqual(OUTPUT_RING_CAPACITY);
		}
		ring.finish();
		readAvailable(4);
		expect(cursor).toBe(ring.headCursor);
		expect(outputs.join("")).toBe(standard.decode(raw));
	});

	test("a gap with too-small budget returns oldest without consuming a character", () => {
		const ring = new OutputRing();
		ring.append(encode("🙂".repeat(OUTPUT_RING_CAPACITY / 4 + 1)));
		const result = ring.read("0", 1);
		expect(result).toEqual({
			gap: true,
			headCursor: String(OUTPUT_RING_CAPACITY + 4),
			nextCursor: "4",
			oldestCursor: "4",
			output: "",
		});
		assertBounded(ring, result, "0", 1);
	});

	test("overflow landing inside an invalid maximal subpart evicts the whole replacement", () => {
		const ring = new OutputRing();
		ring.append(new Uint8Array([0xf0, 0x9f, 0x99]));
		ring.append(encode("a".repeat(OUTPUT_RING_CAPACITY - 3)));
		ring.append(encode("b"));
		expect(ring.oldestCursor).toBe("3");
		const result = ring.read("0", 1);
		expect(result.gap).toBe(true);
		expect(result.output).toBe("a");
		assertBounded(ring, result, "0", 1);
	});
});
