/** biome-ignore-all lint/performance/noAwaitInLoops: Small security matrices run sequentially for deterministic attribution. */
import { describe, expect, mock, spyOn, test } from "bun:test";
import {
	type DataBody,
	type DataEnvelope,
	type DataEnvelopeFailure,
	type DataEnvelopeResult,
	DataEnvelopeSession,
	dataEnvelopeIv,
	decodeDataEnvelope,
	encodeDataEnvelope,
	MAX_DATA_BODY_BYTES,
	MAX_DATA_CIPHERTEXT_BYTES,
	MAX_DATA_ENVELOPE_BYTES,
	MAX_DATA_SEQUENCE,
	MAX_MESSAGE_BYTES,
} from "../../apps/web/src/lib/crypto/data-envelope";
import { EphemeralHandshake } from "../../apps/web/src/lib/crypto/handshake";

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PADDING = /[=]+$/;
const marker = "synthetic-private-body";
const message: DataBody = { id: "test-message", text: marker, type: "message" };

function value<T>(result: DataEnvelopeResult<T>): T {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error("Expected synthetic test operation to succeed");
	}
	return result.value;
}

function rejected(
	result: DataEnvelopeResult<unknown>,
	error: DataEnvelopeFailure
) {
	expect(result).toEqual({ error, ok: false });
	expect(result).not.toHaveProperty("value");
	expect(JSON.stringify(result).includes(marker)).toBe(false);
}

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(PADDING, "");
}

function ciphertextBytes(ciphertext: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(
		atob(ciphertext.replaceAll("-", "+").replaceAll("_", "/")),
		(character) => character.charCodeAt(0)
	);
}

function tamper(envelope: DataEnvelope): DataEnvelope {
	const ciphertext = ciphertextBytes(envelope.ciphertext);
	const last = ciphertext.at(-1);
	if (last === undefined) {
		throw new Error("Expected non-empty synthetic ciphertext");
	}
	ciphertext[ciphertext.length - 1] = last % 2 === 0 ? last + 1 : last - 1;
	return { ...envelope, ciphertext: base64url(ciphertext) };
}

async function authenticated(room = ROOM) {
	const [creator, joiner] = await Promise.all([
		EphemeralHandshake.create(room, "creator"),
		EphemeralHandshake.create(room, "joiner"),
	]);
	await Promise.all([
		creator.acceptPeer(joiner.getHello()),
		joiner.acceptPeer(creator.getHello()),
	]);
	const [cProof, jProof] = await Promise.all([
		creator.createConfirmation(),
		joiner.createConfirmation(),
	]);
	await Promise.all([
		creator.acceptConfirmation(jProof),
		joiner.acceptConfirmation(cProof),
	]);
	return { creator, joiner };
}

async function pair(counterLimit = MAX_DATA_SEQUENCE) {
	const handshakes = await authenticated();
	return {
		creator: value(
			DataEnvelopeSession.create(handshakes.creator, { counterLimit })
		),
		handshakes,
		joiner: value(
			DataEnvelopeSession.create(handshakes.joiner, { counterLimit })
		),
	};
}

/** Independent test encoder; keys are test-owned references, never printed. */
async function seal(
	handshake: EphemeralHandshake,
	plaintext: Uint8Array<ArrayBuffer>,
	sequence = BigInt(0),
	options: {
		sessionId?: string;
		direction?: string;
		iv?: Uint8Array<ArrayBuffer>;
	} = {}
): Promise<DataEnvelope> {
	const sessionId =
		options.sessionId ?? handshake.getSessionMetadata().sessionId;
	const role = handshake.getHello().role;
	const peer = role === "creator" ? "joiner" : "creator";
	const iv = options.iv ?? new Uint8Array(12);
	if (!options.iv) {
		new DataView(iv.buffer).setBigUint64(4, sequence, false);
	}
	const ciphertext = await crypto.subtle.encrypt(
		{
			additionalData: encoder.encode(
				JSON.stringify([
					"glassroom/data",
					1,
					sessionId,
					options.direction ?? `${role}-to-${peer}`,
					sequence.toString(),
				])
			),
			iv,
			name: "AES-GCM",
			tagLength: 128,
		},
		handshake.getSessionKeys().send,
		plaintext
	);
	return {
		ciphertext: base64url(new Uint8Array(ciphertext)),
		sequence: sequence.toString(),
		sessionId,
	};
}

/** Consumer dispatch is strictly behind the codec's authenticated success boundary. */
async function receive(
	session: DataEnvelopeSession,
	input: unknown,
	dispatch: (body: DataBody) => void
) {
	const result = await session.decrypt(input);
	if (result.ok) {
		dispatch(result.value);
	}
	return result;
}

describe("authenticated data envelopes", () => {
	test("four encrypted body variants", async () => {
		const { creator, joiner } = await pair();
		const variants: DataBody[] = [
			message,
			{ messageId: "test-message", type: "acknowledgement" },
			{ confirmed: true, type: "verification" },
			{ type: "end" },
		];
		for (const [sender, receiver] of [
			[creator, joiner],
			[joiner, creator],
		]) {
			for (const body of variants) {
				const envelope = value(await sender.encrypt(body));
				expect(Object.keys(envelope).sort()).toEqual([
					"ciphertext",
					"sequence",
					"sessionId",
				]);
				const wire = value(encodeDataEnvelope(envelope));
				expect(wire.includes('"type"')).toBe(false);
				expect(wire.includes(marker)).toBe(false);
				expect(value(decodeDataEnvelope(wire))).toEqual(envelope);
				expect(value(await receiver.decrypt(wire))).toEqual(body);
			}
		}
		expect(Object.keys(creator)).toEqual([]);
		expect(JSON.stringify(creator)).toBe("{}");
		creator.dispose();
		joiner.dispose();
	});

	test("concurrent unique sequences", async () => {
		const { creator, joiner } = await pair();
		const frames = (
			await Promise.all(
				Array.from({ length: 32 }, () => creator.encrypt(message))
			)
		).map(value);
		expect(frames.map((frame) => frame.sequence)).toEqual(
			Array.from({ length: 32 }, (_, i) => String(i))
		);
		expect(new Set(frames.map((frame) => frame.ciphertext)).size).toBe(32);
		for (const frame of frames) {
			expect(value(await joiner.decrypt(frame))).toEqual(message);
		}
		creator.dispose();
		joiner.dispose();
	});

	test("specified IV bytes", async () => {
		expect([...dataEnvelopeIv(BigInt(0))]).toEqual(new Array(12).fill(0));
		expect([...dataEnvelopeIv(BigInt("72623859790382856"))]).toEqual([
			0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8,
		]);
		expect([...dataEnvelopeIv(MAX_DATA_SEQUENCE)]).toEqual([
			0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255,
		]);
		expect(() => dataEnvelopeIv(BigInt(-1))).toThrow(RangeError);
		expect(() => dataEnvelopeIv(MAX_DATA_SEQUENCE + BigInt(1))).toThrow(
			RangeError
		);
		const { creator, joiner, handshakes } = await pair();
		for (const sequence of [BigInt(0), BigInt(1)]) {
			const frame = value(await creator.encrypt(message));
			// Independent encoding proves the actual encrypt path uses the specified IV and AAD.
			expect(frame).toEqual(
				await seal(
					handshakes.creator,
					encoder.encode(JSON.stringify(message)),
					sequence
				)
			);
			expect(value(await joiner.decrypt(frame))).toEqual(message);
		}
		creator.dispose();
		joiner.dispose();
	});

	test("direction separation", async () => {
		const { creator, joiner, handshakes } = await pair();
		const forward = value(await creator.encrypt(message));
		const reverse = value(await joiner.encrypt(message));
		expect(forward.sequence).toBe("0");
		expect(reverse.sequence).toBe("0");
		expect(forward.ciphertext).not.toBe(reverse.ciphertext);
		// Same sender key, but wrong direction in AAD, must not authenticate.
		const wrongDirection = await seal(
			handshakes.creator,
			encoder.encode(JSON.stringify(message)),
			BigInt(0),
			{ direction: "joiner-to-creator" }
		);
		rejected(await joiner.decrypt(wrongDirection), "authentication_failed");
		rejected(await creator.decrypt(forward), "authentication_failed");
		rejected(await joiner.decrypt(reverse), "authentication_failed");
		expect(value(await joiner.decrypt(forward))).toEqual(message);
		expect(value(await creator.decrypt(reverse))).toEqual(message);
		creator.dispose();
		joiner.dispose();
	});

	test("authenticated envelope fields", async () => {
		const { creator, joiner, handshakes } = await pair();
		const frame = value(await creator.encrypt(message));
		const alternateId =
			frame.sessionId === "0".repeat(32) ? "1".repeat(32) : "0".repeat(32);
		rejected(
			await joiner.decrypt({ ...frame, sessionId: alternateId }),
			"session_mismatch"
		);
		rejected(
			await joiner.decrypt({ ...frame, sequence: "1" }),
			"authentication_failed"
		);
		// Restore the visible session ID after encrypting with a different AAD ID.
		// This proves the ID is authenticated, not just compared in plaintext.
		const differentAad = await seal(
			handshakes.creator,
			encoder.encode(JSON.stringify(message)),
			BigInt(0),
			{ sessionId: alternateId }
		);
		rejected(
			await joiner.decrypt({ ...differentAad, sessionId: frame.sessionId }),
			"authentication_failed"
		);
		// Keep nonce/key/body identical but change only the authenticated sequence.
		const alteredSequence = await seal(
			handshakes.creator,
			encoder.encode(JSON.stringify(message)),
			BigInt(1),
			{ iv: new Uint8Array(12) }
		);
		rejected(
			await joiner.decrypt({ ...alteredSequence, sequence: "0" }),
			"authentication_failed"
		);
		expect(value(await joiner.decrypt(frame))).toEqual(message);
		creator.dispose();
		joiner.dispose();
	});

	test("tamper rejected", async () => {
		const { creator, joiner } = await pair();
		const dispatch = mock((_body: DataBody) => undefined);
		const frame = value(await creator.encrypt(message));
		rejected(
			await receive(joiner, tamper(frame), dispatch),
			"authentication_failed"
		);
		expect(dispatch).not.toHaveBeenCalled();
		expect(value(await receive(joiner, frame, dispatch))).toEqual(message);
		expect(dispatch).toHaveBeenCalledTimes(1);
		creator.dispose();
		joiner.dispose();
	});

	test("duplicate rejected", async () => {
		const { creator, joiner } = await pair();
		const first = value(await creator.encrypt(message));
		const second = value(await creator.encrypt(message));
		const dispatch = mock((_body: DataBody) => undefined);
		const results = await Promise.all([
			receive(joiner, first, dispatch),
			receive(joiner, first, dispatch),
		]);
		expect(value(results[0])).toEqual(message);
		rejected(results[1], "replay_rejected");
		expect(dispatch).toHaveBeenCalledTimes(1);
		value(await receive(joiner, second, dispatch));
		rejected(await receive(joiner, first, dispatch), "replay_rejected");
		rejected(await receive(joiner, second, dispatch), "replay_rejected");
		expect(dispatch).toHaveBeenCalledTimes(2);
		creator.dispose();
		joiner.dispose();
	});

	test("failed authentication preserves receive sequence", async () => {
		const { creator, joiner } = await pair();
		const first = value(await creator.encrypt(message));
		const second = value(await creator.encrypt(message));
		rejected(
			await joiner.decrypt({
				...tamper(second),
				sequence: MAX_DATA_SEQUENCE.toString(),
			}),
			"authentication_failed"
		);
		expect(value(await joiner.decrypt(first))).toEqual(message);
		rejected(await joiner.decrypt(tamper(second)), "authentication_failed");
		expect(value(await joiner.decrypt(second))).toEqual(message);
		rejected(await joiner.decrypt(first), "replay_rejected");
		creator.dispose();
		joiner.dispose();
	});

	test("malformed and over-cap rejection", async () => {
		const { creator, joiner } = await pair();
		const frame = value(await creator.encrypt(message));
		const dispatch = mock((_body: DataBody) => undefined);
		const malformed: unknown[] = [
			null,
			[],
			{},
			"not json",
			"{",
			{ ...frame, role: "creator" },
			{ ...frame, sequence: 0 },
			{ ...frame, sequence: "00" },
			{ ...frame, sequence: "-1" },
			{ ...frame, sequence: "1.5" },
			{ ...frame, sequence: (MAX_DATA_SEQUENCE + BigInt(1)).toString() },
			{ ...frame, sessionId: "invalid" },
			{ ...frame, ciphertext: `${frame.ciphertext}=` },
			{ ...frame, ciphertext: "!".repeat(22) },
			{ ...frame, ciphertext: base64url(new Uint8Array(15)) },
			{
				...frame,
				ciphertext: base64url(new Uint8Array(MAX_DATA_CIPHERTEXT_BYTES + 1)),
			},
			new Uint8Array([255]),
		];
		for (const input of malformed) {
			rejected(await receive(joiner, input, dispatch), "invalid_envelope");
		}
		const wire = value(encodeDataEnvelope(frame));
		// Exact declared frame maximum plus ONE BYTE, otherwise valid JSON (trailing spaces).
		const overCap = encoder.encode(
			wire.padEnd(MAX_DATA_ENVELOPE_BYTES + 1, " ")
		);
		expect(overCap.byteLength).toBe(MAX_DATA_ENVELOPE_BYTES + 1);
		rejected(await receive(joiner, overCap, dispatch), "invalid_envelope");
		rejected(
			await receive(joiner, overCap.buffer, dispatch),
			"invalid_envelope"
		);
		rejected(
			await receive(joiner, decoder.decode(overCap), dispatch),
			"invalid_envelope"
		);
		// UTF-8 bytes, not just JS character count, govern the cap.
		const multibyte = `"${"é".repeat(Math.floor(MAX_DATA_ENVELOPE_BYTES / 2))}"`;
		expect(multibyte.length).toBeLessThan(MAX_DATA_ENVELOPE_BYTES);
		expect(encoder.encode(multibyte).byteLength).toBeGreaterThan(
			MAX_DATA_ENVELOPE_BYTES
		);
		rejected(await receive(joiner, multibyte, dispatch), "invalid_envelope");
		expect(dispatch).not.toHaveBeenCalled();
		// At the declared cap, valid padded JSON is accepted and dispatched once.
		value(
			await receive(joiner, wire.padEnd(MAX_DATA_ENVELOPE_BYTES, " "), dispatch)
		);
		expect(dispatch).toHaveBeenCalledTimes(1);
		creator.dispose();
		joiner.dispose();
	});

	test("counter exhaustion", async () => {
		const { creator, joiner } = await pair(BigInt(1));
		const first = value(await creator.encrypt(message));
		const last = value(await creator.encrypt(message));
		expect(first.sequence).toBe("0");
		expect(last.sequence).toBe("1");
		rejected(
			await joiner.decrypt({ ...last, sequence: "2" }),
			"counter_exhausted"
		);
		expect(joiner.disposed).toBe(false);
		value(await joiner.decrypt(first));
		value(await joiner.decrypt(last));
		const overflow = await Promise.all([
			creator.encrypt(message),
			creator.encrypt(message),
		]);
		rejected(overflow[0], "counter_exhausted");
		rejected(overflow[1], "disposed");
		expect(creator.disposed).toBe(true);
		rejected(await creator.decrypt(first), "disposed");
		joiner.dispose();
	});

	test("full uint64 receive boundary", async () => {
		const { creator, joiner, handshakes } = await pair();
		const frame = await seal(
			handshakes.creator,
			encoder.encode(JSON.stringify(message)),
			MAX_DATA_SEQUENCE
		);
		expect(value(await joiner.decrypt(frame))).toEqual(message);
		rejected(await joiner.decrypt(frame), "replay_rejected");
		rejected(
			await joiner.decrypt({
				...frame,
				sequence: (MAX_DATA_SEQUENCE + BigInt(1)).toString(),
			}),
			"invalid_envelope"
		);
		creator.dispose();
		joiner.dispose();
	});

	test("strict encrypted body validation and UTF-8 message bound", async () => {
		const { creator, joiner, handshakes } = await pair();
		const dispatch = mock((_body: DataBody) => undefined);
		const invalid: unknown[] = [
			null,
			{},
			{ type: "unknown" },
			{ text: marker, type: "end" },
			{ confirmed: "yes", type: "verification" },
			{ messageId: "", type: "acknowledgement" },
			{ ...message, id: "x".repeat(65) },
			{ ...message, text: "" },
			{ ...message, text: "x".repeat(MAX_MESSAGE_BYTES + 1) },
			{ ...message, text: "é".repeat(MAX_MESSAGE_BYTES / 2 + 1) },
		];
		for (const body of invalid) {
			rejected(await creator.encrypt(body), "invalid_body");
			const forged = await seal(
				handshakes.creator,
				encoder.encode(JSON.stringify(body))
			);
			rejected(await receive(joiner, forged, dispatch), "invalid_body");
		}
		for (const raw of [encoder.encode("not JSON"), new Uint8Array([255])]) {
			rejected(
				await receive(joiner, await seal(handshakes.creator, raw), dispatch),
				"invalid_body"
			);
		}
		expect(dispatch).not.toHaveBeenCalled();
		const maximumBodies = [
			"x".repeat(MAX_MESSAGE_BYTES),
			"é".repeat(MAX_MESSAGE_BYTES / 2),
			"\u0000".repeat(MAX_MESSAGE_BYTES),
		];
		for (const text of maximumBodies) {
			const body = { ...message, text };
			expect(encoder.encode(text).byteLength).toBe(MAX_MESSAGE_BYTES);
			expect(
				encoder.encode(JSON.stringify(body)).byteLength
			).toBeLessThanOrEqual(MAX_DATA_BODY_BYTES);
			const frame = value(await creator.encrypt(body));
			expect(value(await receive(joiner, frame, dispatch))).toEqual(body);
		}
		expect(dispatch).toHaveBeenCalledTimes(3);
		creator.dispose();
		joiner.dispose();
	});

	test("one-shot ownership, strict room IDs, and disposal without resumption", async () => {
		const newHandshake = await EphemeralHandshake.create(ROOM, "creator");
		rejected(DataEnvelopeSession.create(newHandshake), "invalid_input");
		newHandshake.destroy();
		for (const room of ["loose-room", "AAAAAAAAAAAAAAAAAAAAAB"]) {
			const handshakes = await authenticated(room);
			rejected(DataEnvelopeSession.create(handshakes.creator), "invalid_input");
			handshakes.creator.destroy();
			handshakes.joiner.destroy();
		}
		const { creator, joiner, handshakes } = await pair();
		const oldSessionId = handshakes.creator.getSessionMetadata().sessionId;
		rejected(DataEnvelopeSession.create(handshakes.creator), "invalid_input");
		expect(() =>
			Reflect.construct(DataEnvelopeSession, [
				handshakes.creator,
				MAX_DATA_SEQUENCE,
			])
		).toThrow("Invalid data session construction");
		expect(() =>
			Reflect.construct(DataEnvelopeSession, [
				handshakes.creator,
				MAX_DATA_SEQUENCE,
				Symbol("data-envelope-session"),
			])
		).toThrow("Invalid data session construction");
		const queued = creator.encrypt(message);
		creator.dispose();
		rejected(await queued, "disposed");
		creator.dispose();
		expect(handshakes.creator.state).toBe("destroyed");
		rejected(DataEnvelopeSession.create(handshakes.creator), "invalid_input");
		rejected(await creator.encrypt(message), "disposed");
		const pendingReceive = joiner.decrypt({});
		joiner.dispose();
		rejected(await pendingReceive, "disposed");
		const fresh = await pair();
		expect(fresh.handshakes.creator.getSessionMetadata().sessionId).not.toBe(
			oldSessionId
		);
		expect(value(await fresh.creator.encrypt(message)).sequence).toBe("0");
		fresh.creator.dispose();
		fresh.joiner.dispose();
	});

	test("snapshots and invalid counter limits", async () => {
		const handshakes = await authenticated();
		for (const counterLimit of [BigInt(-1), MAX_DATA_SEQUENCE + BigInt(1)]) {
			rejected(
				DataEnvelopeSession.create(handshakes.creator, { counterLimit }),
				"invalid_input"
			);
		}
		const creator = value(DataEnvelopeSession.create(handshakes.creator));
		const joiner = value(DataEnvelopeSession.create(handshakes.joiner));
		const mutable = { ...message };
		const pending = creator.encrypt(mutable);
		mutable.text = "changed";
		const frame = value(await pending);
		const receiving = joiner.decrypt(frame);
		frame.sequence = "99";
		expect(value(await receiving)).toEqual(message);
		creator.dispose();
		joiner.dispose();
	});

	test("encryption failure terminates without nonce reuse", async () => {
		const { creator, joiner, handshakes } = await pair();
		const encryptSpy = spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(
			new Error("synthetic engine failure")
		);
		try {
			rejected(await creator.encrypt(message), "encryption_failed");
			expect(creator.disposed).toBe(true);
			rejected(await creator.encrypt(message), "disposed");
			rejected(DataEnvelopeSession.create(handshakes.creator), "invalid_input");
			expect(encryptSpy).toHaveBeenCalledTimes(1);
		} finally {
			encryptSpy.mockRestore();
			creator.dispose();
			joiner.dispose();
		}
	});

	test("in-flight teardown releases neither ciphertext nor authenticated body", async () => {
		const peers = await pair();
		const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		const sendStarted = Promise.withResolvers<void>();
		const sendRelease = Promise.withResolvers<void>();
		const encryptSpy = spyOn(crypto.subtle, "encrypt").mockImplementation(
			async (algorithm, key, data) => {
				const result = await originalEncrypt(algorithm, key, data);
				sendStarted.resolve();
				await sendRelease.promise;
				return result;
			}
		);
		try {
			const pending = peers.creator.encrypt(message);
			await sendStarted.promise;
			peers.creator.dispose();
			sendRelease.resolve();
			rejected(await pending, "disposed");
		} finally {
			sendRelease.resolve();
			encryptSpy.mockRestore();
			peers.creator.dispose();
			peers.joiner.dispose();
		}
		const fresh = await pair();
		const frame = value(await fresh.creator.encrypt(message));
		const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
		const receiveStarted = Promise.withResolvers<void>();
		const receiveRelease = Promise.withResolvers<void>();
		let enginePlaintext: ArrayBuffer | undefined;
		const decryptSpy = spyOn(crypto.subtle, "decrypt").mockImplementation(
			async (algorithm, key, data) => {
				const result = await originalDecrypt(algorithm, key, data);
				enginePlaintext = result;
				receiveStarted.resolve();
				await receiveRelease.promise;
				return result;
			}
		);
		try {
			const dispatch = mock((_body: DataBody) => undefined);
			const pending = receive(fresh.joiner, frame, dispatch);
			await receiveStarted.promise;
			fresh.joiner.dispose();
			receiveRelease.resolve();
			rejected(await pending, "disposed");
			expect(dispatch).not.toHaveBeenCalled();
			if (!enginePlaintext) {
				throw new Error("Expected synthetic engine plaintext");
			}
			expect(new Uint8Array(enginePlaintext).every((byte) => byte === 0)).toBe(
				true
			);
		} finally {
			receiveRelease.resolve();
			decryptSpy.mockRestore();
			fresh.creator.dispose();
			fresh.joiner.dispose();
		}
	});
});
