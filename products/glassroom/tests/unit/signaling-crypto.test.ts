import { describe, expect, test } from "bun:test";
import {
	type CryptoResult,
	createSignalingCrypto,
	decodeSignalingEnvelope,
	deriveSignalingKeys,
	encodeSignalingEnvelope,
	MAX_SIGNALING_COUNTER,
	MAX_SIGNALING_PLAINTEXT_BYTES,
	type SignalingCrypto,
	type SignalingEnvelope,
	type SignalingFailure,
	type SignalingRole,
} from "../../apps/web/src/lib/crypto/signaling";

const encoder = new TextEncoder();
const marker = "private-signaling-test-marker";
const plaintext = encoder.encode(marker);
// Synthetic fixtures only; no real invitation secrets or payloads are printed.
const secret = new Uint8Array(32).fill(42);
const wrongSecret = new Uint8Array(32).fill(43);
const BASE64_PADDING_REGEX = /[=]+$/;
function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(BASE64_PADDING_REGEX, "");
}
const roomId = base64url(new Uint8Array(16).fill(7));
const otherRoomId = base64url(new Uint8Array(16).fill(8));

function value<T>(result: CryptoResult<T>): T {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error("Expected synthetic test operation to succeed");
	}
	return result.value;
}

function rejected(
	result: CryptoResult<unknown>,
	error: SignalingFailure
): void {
	expect(result).toEqual({ error, ok: false });
	expect(result).not.toHaveProperty("value");
	expect(result).not.toHaveProperty("plaintext");
	const redacted = JSON.stringify(result);
	for (const sensitive of [
		marker,
		base64url(secret),
		base64url(wrongSecret),
		secret.join(","),
	]) {
		expect(redacted.includes(sensitive)).toBe(false);
	}
}

async function peer(
	role: SignalingRole,
	options: {
		invitationSecret?: Uint8Array;
		roomId?: string;
		counterLimit?: bigint;
	} = {}
): Promise<SignalingCrypto> {
	return value(
		await createSignalingCrypto({
			invitationSecret: secret,
			role,
			roomId,
			...options,
		})
	);
}

function tamper(envelope: SignalingEnvelope): SignalingEnvelope {
	const binary = atob(
		envelope.ciphertext.replaceAll("-", "+").replaceAll("_", "/")
	);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	const lastByte = bytes.at(-1);
	if (lastByte === undefined) {
		throw new Error("Expected non-empty synthetic ciphertext");
	}
	// Flip exactly the least-significant bit without a bitwise operator.
	bytes[bytes.length - 1] = lastByte % 2 === 0 ? lastByte + 1 : lastByte - 1;
	return { ...envelope, ciphertext: base64url(bytes) };
}

describe("invitation-authenticated signaling", () => {
	test("same-secret round trip", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		for (const [sender, receiver] of [
			[creator, joiner],
			[joiner, creator],
		]) {
			const envelope = value(await sender.encrypt(plaintext));
			expect(envelope.counter).toBe("0");
			const wire = value(encodeSignalingEnvelope(envelope));
			expect(wire.includes(marker)).toBe(false);
			expect(value(decodeSignalingEnvelope(wire))).toEqual(envelope);
			expect(value(await receiver.decrypt(wire))).toEqual(plaintext);
			expect(
				value(
					await receiver.decrypt(value(await sender.encrypt(new Uint8Array())))
				)
			).toEqual(new Uint8Array());
		}
		creator.close();
		joiner.close();
	});

	test("directional key separation", async () => {
		const keys = value(await deriveSignalingKeys(secret, roomId));
		expect(keys.creatorToJoiner.extractable).toBe(false);
		expect(keys.joinerToCreator.extractable).toBe(false);
		expect(keys.creatorToJoiner.algorithm as AesKeyAlgorithm).toEqual({
			length: 256,
			name: "AES-GCM",
		});
		const parameters = {
			iv: new Uint8Array(12),
			name: "AES-GCM",
			tagLength: 128,
		};
		const first = await crypto.subtle.encrypt(
			parameters,
			keys.creatorToJoiner,
			plaintext
		);
		const second = await crypto.subtle.encrypt(
			parameters,
			keys.joinerToCreator,
			plaintext
		);
		expect(new Uint8Array(first)).not.toEqual(new Uint8Array(second));
		const creator = await peer("creator");
		const frame = value(await creator.encrypt(plaintext));
		rejected(await creator.decrypt(frame), "context_mismatch");
		creator.close();
	});

	test("wrong secret", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner", { invitationSecret: wrongSecret });
		rejected(
			await joiner.decrypt(value(await creator.encrypt(plaintext))),
			"authentication_failed"
		);
		creator.close();
		joiner.close();
	});

	test("AAD mismatch", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const frame = value(await creator.encrypt(plaintext));
		rejected(
			await joiner.decrypt({ ...frame, version: 2 }),
			"invalid_envelope"
		);
		rejected(
			await joiner.decrypt({ ...frame, roomId: otherRoomId }),
			"context_mismatch"
		);
		rejected(
			await joiner.decrypt({ ...frame, role: "joiner" }),
			"context_mismatch"
		);
		rejected(
			await joiner.decrypt({ ...frame, operation: "join" }),
			"invalid_envelope"
		);
		rejected(
			await joiner.decrypt({ ...frame, counter: "1" }),
			"authentication_failed"
		);
		expect(value(await joiner.decrypt(frame))).toEqual(plaintext);
		creator.close();
		joiner.close();
	});

	test("ciphertext tamper", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const frame = value(await creator.encrypt(plaintext));
		rejected(await joiner.decrypt(tamper(frame)), "authentication_failed");
		expect(value(await joiner.decrypt(frame))).toEqual(plaintext);
		creator.close();
		joiner.close();
	});

	test("replay rejected", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const first = value(await creator.encrypt(plaintext));
		const second = value(await creator.encrypt(plaintext));
		value(await joiner.decrypt(first));
		rejected(await joiner.decrypt(first), "replay_rejected");
		value(await joiner.decrypt(second));
		rejected(await joiner.decrypt(first), "replay_rejected");
		rejected(await joiner.decrypt(second), "replay_rejected");
		creator.close();
		joiner.close();
	});

	test("failed authentication preserves counter", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const first = value(await creator.encrypt(plaintext));
		const second = value(await creator.encrypt(plaintext));
		rejected(
			await joiner.decrypt({
				...tamper(second),
				counter: MAX_SIGNALING_COUNTER.toString(),
			}),
			"authentication_failed"
		);
		expect(value(await joiner.decrypt(first))).toEqual(plaintext);
		rejected(await joiner.decrypt(tamper(second)), "authentication_failed");
		expect(value(await joiner.decrypt(second))).toEqual(plaintext);
		rejected(await joiner.decrypt(first), "replay_rejected");
		creator.close();
		joiner.close();
	});

	test("counter exhaustion closes", async () => {
		// A conservative cap reaches the same branch as uint64 exhaustion without 2^64 sends.
		const creator = await peer("creator", { counterLimit: BigInt(1) });
		const joiner = await peer("joiner", { counterLimit: BigInt(1) });
		const first = value(await creator.encrypt(plaintext));
		const last = value(await creator.encrypt(plaintext));
		expect(first.counter).toBe("0");
		expect(last.counter).toBe("1");
		expect(first.ciphertext).not.toBe(last.ciphertext);
		rejected(
			await joiner.decrypt({ ...last, counter: "2" }),
			"counter_exhausted"
		);
		expect(joiner.closed).toBe(false);
		value(await joiner.decrypt(first));
		value(await joiner.decrypt(last));
		rejected(await creator.encrypt(plaintext), "counter_exhausted");
		expect(creator.closed).toBe(true);
		rejected(await creator.encrypt(plaintext), "closed");
		rejected(await creator.decrypt(first), "closed");
		rejected(await joiner.decrypt(first), "replay_rejected");
		joiner.close();
	});

	test("invalid encodings do not release plaintext or consume receive state", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const frame = value(await creator.encrypt(plaintext));
		const malformed: unknown[] = [
			null,
			[],
			{},
			"not json",
			`{"payload":"${marker}"`,
			{ ...frame, extra: marker },
			{ ...frame, counter: 0 },
			{ ...frame, counter: "00" },
			{ ...frame, counter: "-1" },
			{ ...frame, counter: "1.5" },
			{ ...frame, counter: (MAX_SIGNALING_COUNTER + BigInt(1)).toString() },
			{ ...frame, ciphertext: `${frame.ciphertext}=` },
			{ ...frame, ciphertext: "!".repeat(22) },
			{ ...frame, ciphertext: base64url(new Uint8Array(15)) },
			{
				...frame,
				ciphertext: base64url(
					new Uint8Array(MAX_SIGNALING_PLAINTEXT_BYTES + 17)
				),
			},
			{ ...frame, roomId: `${roomId}=` },
			" ".repeat(90_000),
		];
		for (const input of malformed) {
			rejected(await joiner.decrypt(input), "invalid_envelope");
			rejected(encodeSignalingEnvelope(input), "invalid_envelope");
		}
		expect(value(await joiner.decrypt(frame))).toEqual(plaintext);
		creator.close();
		joiner.close();
	});

	test("concurrent sends use unique counters and concurrent receives reject duplicate", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const frames = (
			await Promise.all(
				Array.from({ length: 32 }, () => creator.encrypt(plaintext))
			)
		).map(value);
		expect(frames.map((frame) => frame.counter)).toEqual(
			Array.from({ length: 32 }, (_, index) => String(index))
		);
		expect(new Set(frames.map((frame) => frame.ciphertext)).size).toBe(32);
		const results = await Promise.all([
			joiner.decrypt(frames[0]),
			joiner.decrypt(frames[0]),
		]);
		expect(value(results[0])).toEqual(plaintext);
		rejected(results[1], "replay_rejected");
		for (const frame of frames.slice(1)) {
			expect(value(await joiner.decrypt(frame))).toEqual(plaintext);
		}
		creator.close();
		joiner.close();
	});

	test("room salt separation", async () => {
		const first = value(await deriveSignalingKeys(secret, roomId));
		const second = value(await deriveSignalingKeys(secret, otherRoomId));
		const parameters = { iv: new Uint8Array(12), name: "AES-GCM" };
		expect(
			new Uint8Array(
				await crypto.subtle.encrypt(
					parameters,
					first.creatorToJoiner,
					plaintext
				)
			)
		).not.toEqual(
			new Uint8Array(
				await crypto.subtle.encrypt(
					parameters,
					second.creatorToJoiner,
					plaintext
				)
			)
		);
		const creator = await peer("creator");
		const wrongRoom = await peer("joiner", { roomId: otherRoomId });
		const frame = value(await creator.encrypt(plaintext));
		rejected(await wrongRoom.decrypt(frame), "context_mismatch");
		rejected(
			await wrongRoom.decrypt({ ...frame, roomId: otherRoomId }),
			"authentication_failed"
		);
		creator.close();
		wrongRoom.close();
	});

	test("uint64 boundary is validated without floating point rounding", async () => {
		const keys = value(await deriveSignalingKeys(secret, roomId));
		const header = {
			counter: MAX_SIGNALING_COUNTER.toString(),
			operation: "forward" as const,
			role: "creator" as const,
			roomId,
			version: 1 as const,
		};
		const iv = new Uint8Array(12);
		new DataView(iv.buffer).setBigUint64(4, MAX_SIGNALING_COUNTER, false);
		const aad = encoder.encode(
			JSON.stringify([
				"glassroom/signaling",
				1,
				roomId,
				"creator",
				"forward",
				header.counter,
			])
		);
		const ciphertext = base64url(
			new Uint8Array(
				await crypto.subtle.encrypt(
					{ additionalData: aad, iv, name: "AES-GCM", tagLength: 128 },
					keys.creatorToJoiner,
					plaintext
				)
			)
		);
		const frame = { ...header, ciphertext };
		const joiner = await peer("joiner");
		expect(value(await joiner.decrypt(frame))).toEqual(plaintext);
		rejected(await joiner.decrypt(frame), "replay_rejected");
		rejected(
			await joiner.decrypt({
				...frame,
				counter: (MAX_SIGNALING_COUNTER + BigInt(1)).toString(),
			}),
			"invalid_envelope"
		);
		joiner.close();
	});

	test("invalid initialization and oversized plaintext are redacted", async () => {
		for (const invitationSecret of [new Uint8Array(31), new Uint8Array(33)]) {
			rejected(
				await createSignalingCrypto({
					invitationSecret,
					role: "creator",
					roomId,
				}),
				"invalid_input"
			);
		}
		for (const counterLimit of [
			BigInt(-1),
			MAX_SIGNALING_COUNTER + BigInt(1),
		]) {
			rejected(
				await createSignalingCrypto({
					counterLimit,
					invitationSecret: secret,
					role: "creator",
					roomId,
				}),
				"invalid_input"
			);
		}
		rejected(await deriveSignalingKeys(secret, `${roomId}=`), "invalid_input");
		const creator = await peer("creator");
		rejected(
			await creator.encrypt(new Uint8Array(MAX_SIGNALING_PLAINTEXT_BYTES + 1)),
			"invalid_input"
		);
		expect(value(await creator.encrypt(plaintext)).counter).toBe("0");
		creator.close();
		rejected(await creator.encrypt(plaintext), "closed");
	});

	test("queued plaintext and envelope inputs are snapshotted", async () => {
		const creator = await peer("creator");
		const joiner = await peer("joiner");
		const bytes = Uint8Array.from(plaintext);
		const pending = creator.encrypt(bytes);
		bytes.fill(0);
		const frame = value(await pending);
		const receiving = joiner.decrypt(frame);
		frame.counter = "99";
		expect(value(await receiving)).toEqual(plaintext);
		creator.close();
		joiner.close();
	});
});
