/** biome-ignore-all lint/performance/noAwaitInLoops: Security matrices and ordered receives intentionally run sequentially. */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	type DataBody,
	DataEnvelopeSession,
	encodeDataEnvelope,
	MAX_MESSAGE_BYTES,
} from "../../apps/web/src/lib/crypto/data-envelope";
import {
	EphemeralHandshake,
	HandshakeError,
	type HandshakeHello,
	type TranscriptConfirmation,
} from "../../apps/web/src/lib/crypto/handshake";
import {
	type CryptoResult,
	createSignalingCrypto,
	encodeSignalingEnvelope,
	type SignalingCrypto,
	type SignalingEnvelope,
	type SignalingRole,
} from "../../apps/web/src/lib/crypto/signaling";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ROOM = "AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ROOM = "AQEBAQEBAQEBAQEBAQEBAQ";
const THIRD_ROOM = "AgICAgICAgICAgICAgICAg";
// Synthetic invitations only. Assertions compare sensitive values as booleans,
// so even a failing test cannot print secrets, fingerprints, or key identities.
const SECRET = new Uint8Array(32).fill(131);
const WRONG_SECRET = new Uint8Array(32).fill(132);
const PADDING = /[=]+$/;
const FINGERPRINT = /^[0-9A-F]{4}( [0-9A-F]{4}){7}$/;
const message: DataBody = {
	id: "release-message",
	text: "synthetic-release-text",
	type: "message",
};
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
interface Peer {
	handshake: EphemeralHandshake;
	signaling: SignalingCrypto;
}
const ownedPeers: Peer[] = [];
const ownedSessions: DataEnvelopeSession[] = [];

afterEach(() => {
	for (const ownedSession of ownedSessions.splice(0)) {
		ownedSession.dispose();
	}
	for (const ownedPeer of ownedPeers.splice(0)) {
		ownedPeer.signaling.close();
		ownedPeer.handshake.destroy();
	}
});

function value<T>(result: Result<T>): T {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error("Synthetic release operation rejected");
	}
	return result.value;
}

function rejected(result: Result<unknown>, error: string) {
	expect(result).toEqual({ error, ok: false });
	expect(result).not.toHaveProperty("value");
}

function locked(endpoint: Peer) {
	expect(endpoint.handshake.state === "authenticated").toBe(false);
	expect(() => endpoint.handshake.getSessionKeys()).toThrow(HandshakeError);
	expect(() => endpoint.handshake.getFingerprint()).toThrow(HandshakeError);
	rejected(DataEnvelopeSession.create(endpoint.handshake), "invalid_input");
}

async function peer(
	role: SignalingRole,
	roomId: string,
	invitationSecret: Uint8Array
): Promise<Peer> {
	const created = {
		handshake: await EphemeralHandshake.create(roomId, role),
		signaling: value(
			await createSignalingCrypto({ invitationSecret, role, roomId })
		),
	};
	ownedPeers.push(created);
	return created;
}

async function pair(
	room = ROOM,
	joinerSecret = SECRET,
	creatorSecret = SECRET
) {
	const [creator, joiner] = await Promise.all([
		peer("creator", room, creatorSecret),
		peer("joiner", room, joinerSecret),
	]);
	return { creator, joiner };
}

async function seal(
	sender: Peer,
	body: HandshakeHello | TranscriptConfirmation
): Promise<SignalingEnvelope> {
	return value(
		await sender.signaling.encrypt(encoder.encode(JSON.stringify(body)))
	);
}

/** Test-only caller boundary: never dispatch bytes on failed signaling auth.
 * Handshake deliberately accepts decoded objects, not invitation credentials;
 * transport integration must enforce this same boundary (signaling.md).
 */
async function deliver(
	receiver: Peer,
	frame: unknown,
	stage: "hello" | "confirmation"
): Promise<CryptoResult<void>> {
	const decrypted = await receiver.signaling.decrypt(frame);
	if (!decrypted.ok) {
		return decrypted;
	}
	try {
		const body: unknown = JSON.parse(decoder.decode(decrypted.value));
		if (stage === "hello") {
			await receiver.handshake.acceptPeer(body);
		} else {
			await receiver.handshake.acceptConfirmation(body);
		}
		return { ok: true, value: undefined };
	} finally {
		decrypted.value.fill(0);
	}
}

async function hellos(peers: Awaited<ReturnType<typeof pair>>) {
	const [creatorFrame, joinerFrame] = await Promise.all([
		seal(peers.creator, peers.creator.handshake.getHello()),
		seal(peers.joiner, peers.joiner.handshake.getHello()),
	]);
	value(
		await deliver(
			peers.joiner,
			value(encodeSignalingEnvelope(creatorFrame)),
			"hello"
		)
	);
	value(
		await deliver(
			peers.creator,
			value(encodeSignalingEnvelope(joinerFrame)),
			"hello"
		)
	);
}

async function proofs(peers: Awaited<ReturnType<typeof pair>>) {
	const [creatorProof, joinerProof] = await Promise.all([
		peers.creator.handshake.createConfirmation(),
		peers.joiner.handshake.createConfirmation(),
	]);
	return { creatorProof, joinerProof };
}

function session(peerInstance: Peer): DataEnvelopeSession {
	const created = value(DataEnvelopeSession.create(peerInstance.handshake));
	ownedSessions.push(created);
	return created;
}

async function confirmed(room = ROOM, secret = SECRET) {
	const peers = await pair(room, secret, secret);
	locked(peers.creator);
	locked(peers.joiner);
	await hellos(peers);
	locked(peers.creator);
	locked(peers.joiner);
	const { creatorProof, joinerProof } = await proofs(peers);
	locked(peers.creator);
	locked(peers.joiner);
	value(
		await deliver(
			peers.creator,
			await seal(peers.joiner, joinerProof),
			"confirmation"
		)
	);
	value(
		await deliver(
			peers.joiner,
			await seal(peers.creator, creatorProof),
			"confirmation"
		)
	);
	return {
		...peers,
		creatorSession: session(peers.creator),
		joinerSession: session(peers.joiner),
	};
}

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url").replace(PADDING, "");
}

function tamper<T extends { ciphertext: string }>(frame: T): T {
	const bytes = Buffer.from(frame.ciphertext, "base64url");
	const last = bytes.at(-1);
	if (last === undefined) {
		throw new Error("Empty synthetic ciphertext");
	}
	bytes[bytes.length - 1] = last % 2 === 0 ? last + 1 : last - 1;
	return { ...frame, ciphertext: base64url(bytes) };
}

function changeHex(text: string) {
	return `${text[0] === "0" ? "1" : "0"}${text.slice(1)}`;
}

/** Capture ACTUAL AES-GCM calls, not reconstructed counters. A deterministic
 * encryption probe identifies key material even across distinct CryptoKey objects.
 * Its nonzero IV prefix is outside both modules' zero32 nonce namespace; the
 * probe runs once per key, bypasses the spy, and is never logged/exported.
 */
function captureNonces() {
	const original = crypto.subtle.encrypt.bind(crypto.subtle);
	const identities = new WeakMap<CryptoKey, Promise<string>>();
	const captured: {
		identity: string;
		iv: string;
		protocol: string;
		direction: string;
		sequence: string;
		context: string;
	}[] = [];
	const spy = spyOn(crypto.subtle, "encrypt").mockImplementation(
		async (algorithm, key, data) => {
			const params = algorithm as AesGcmParams;
			const header: unknown = JSON.parse(decoder.decode(params.additionalData));
			if (!Array.isArray(header)) {
				throw new Error("Unexpected synthetic AES header");
			}
			let identity = identities.get(key);
			if (!identity) {
				const probeIv = new Uint8Array(12).fill(165);
				identity = original(
					{ iv: probeIv, name: "AES-GCM" },
					key,
					encoder.encode("release-key-identity-probe")
				).then((bytes) => base64url(new Uint8Array(bytes)));
				identities.set(key, identity);
			}
			const iv = new Uint8Array(
				params.iv instanceof ArrayBuffer ? params.iv : params.iv.buffer,
				params.iv instanceof ArrayBuffer ? 0 : params.iv.byteOffset,
				params.iv.byteLength
			);
			const protocol = String(header[0]);
			captured.push({
				context: String(header[2]),
				direction:
					protocol === "glassroom/signaling"
						? `${String(header[3])}-to-${header[3] === "creator" ? "joiner" : "creator"}`
						: String(header[3]),
				identity: await identity,
				iv: base64url(iv),
				protocol,
				sequence: String(header.at(-1)),
			});
			return original(algorithm, key, data);
		}
	);
	return { captured, restore: () => spy.mockRestore() };
}

describe("cross-module crypto release invariants", () => {
	test("confirmed two-role session", async () => {
		const peers = await confirmed();
		for (const endpoint of [peers.creator, peers.joiner]) {
			expect(endpoint.handshake.state).toBe("authenticated");
			expect(FINGERPRINT.test(endpoint.handshake.getFingerprint())).toBe(true);
			for (const key of Object.values(endpoint.handshake.getSessionKeys())) {
				expect(key.extractable).toBe(false);
				expect(key.algorithm.name).toBe("AES-GCM");
			}
		}
		expect(
			peers.creator.handshake.getFingerprint() ===
				peers.joiner.handshake.getFingerprint()
		).toBe(true);
		expect(
			peers.creator.handshake.getSessionMetadata().transcriptHash ===
				peers.joiner.handshake.getSessionMetadata().transcriptHash
		).toBe(true);
		// Authenticated verification controls are possible only after transcript
		// confirmation. Human mutual-verification/chat policy belongs to the caller.
		for (const [sender, receiver] of [
			[peers.creatorSession, peers.joinerSession],
			[peers.joinerSession, peers.creatorSession],
		] as const) {
			for (const body of [
				{ confirmed: false, type: "verification" },
				{ confirmed: true, type: "verification" },
				message,
				{ messageId: "release-message", type: "acknowledgement" },
				{ type: "end" },
			] as const) {
				const frame = value(await sender.encrypt(body));
				const wire = value(encodeDataEnvelope(frame));
				expect(wire.includes("synthetic-release-text")).toBe(false);
				expect(wire.includes('"type"')).toBe(false);
				expect(value(await receiver.decrypt(wire))).toEqual(body);
			}
		}
	});

	test("both transcript confirmations gate session access in either arrival order", async () => {
		const peers = await pair();
		await hellos(peers);
		const joinerProof = await peers.joiner.handshake.createConfirmation();
		locked(peers.joiner);
		value(
			await deliver(
				peers.creator,
				await seal(peers.joiner, joinerProof),
				"confirmation"
			)
		);
		locked(peers.creator); // peer-only confirmation
		locked(peers.joiner); // local-only confirmation
		const creatorProof = await peers.creator.handshake.createConfirmation();
		expect(peers.creator.handshake.state).toBe("authenticated");
		session(peers.creator);
		locked(peers.joiner);
		value(
			await deliver(
				peers.joiner,
				await seal(peers.creator, creatorProof),
				"confirmation"
			)
		);
		expect(peers.joiner.handshake.state).toBe("authenticated");
		session(peers.joiner);
		expect(
			peers.creator.handshake.getFingerprint() ===
				peers.joiner.handshake.getFingerprint()
		).toBe(true);
	});

	test("wrong secret never authenticates", async () => {
		const peers = await pair(ROOM, WRONG_SECRET);
		for (const [sender, receiver] of [
			[peers.creator, peers.joiner],
			[peers.joiner, peers.creator],
		] as const) {
			const frame = await seal(sender, sender.handshake.getHello());
			rejected(
				await deliver(receiver, frame, "hello"),
				"authentication_failed"
			);
			expect(receiver.handshake.state).toBe("new");
			locked(receiver);
			await expect(
				receiver.handshake.createConfirmation()
			).rejects.toBeInstanceOf(HandshakeError);
		}
		locked(peers.creator);
		locked(peers.joiner);
	});

	test("unauthenticated signaling and replay never advance handshake trust", async () => {
		const peers = await pair();
		const frame = await seal(peers.creator, peers.creator.handshake.getHello());
		for (const input of [
			tamper(frame),
			{ ...frame, counter: "999" },
			{ ...frame, role: "joiner" },
			peers.creator.handshake.getHello(),
		]) {
			const result = await deliver(peers.joiner, input, "hello");
			expect(result.ok).toBe(false);
			expect(result).not.toHaveProperty("value");
			expect(peers.joiner.handshake.state).toBe("new");
			locked(peers.joiner);
		}
		value(await deliver(peers.joiner, frame, "hello"));
		rejected(await deliver(peers.joiner, frame, "hello"), "replay_rejected");
		locked(peers.joiner);
		value(
			await deliver(
				peers.creator,
				await seal(peers.joiner, peers.joiner.handshake.getHello()),
				"hello"
			)
		);
		const { creatorProof, joinerProof } = await proofs(peers);
		const proofFrame = await seal(peers.creator, creatorProof);
		rejected(
			await deliver(peers.joiner, tamper(proofFrame), "confirmation"),
			"authentication_failed"
		);
		locked(peers.creator);
		locked(peers.joiner);
		value(await deliver(peers.joiner, proofFrame, "confirmation"));
		rejected(
			await deliver(peers.joiner, proofFrame, "confirmation"),
			"replay_rejected"
		);
		value(
			await deliver(
				peers.creator,
				await seal(peers.joiner, joinerProof),
				"confirmation"
			)
		);
		session(peers.creator);
		session(peers.joiner);
	});

	test("substitution never authenticates", async () => {
		for (const substitution of ["nonce", "publicKey"] as const) {
			const peers = await pair();
			const replacement = await peer("creator", ROOM, SECRET);
			const originalHello = peers.creator.handshake.getHello();
			const alteredHello = {
				...originalHello,
				[substitution]:
					substitution === "nonce"
						? changeHex(originalHello.nonce)
						: replacement.handshake.getHello().publicKey,
			};
			// Even an invitation holder able to reseal a substituted hello cannot
			// make mismatched ECDH/transcript views pass the confirmation HMAC.
			value(
				await deliver(
					peers.joiner,
					await seal(peers.creator, alteredHello),
					"hello"
				)
			);
			value(
				await deliver(
					peers.creator,
					await seal(peers.joiner, peers.joiner.handshake.getHello()),
					"hello"
				)
			);
			const { creatorProof, joinerProof } = await proofs(peers);
			expect(
				peers.creator.handshake.getSessionMetadata().transcriptHash ===
					peers.joiner.handshake.getSessionMetadata().transcriptHash
			).toBe(false);
			locked(peers.creator);
			locked(peers.joiner);
			const creatorExpected = peers.creator.handshake.getSessionMetadata();
			const joinerExpected = peers.joiner.handshake.getSessionMetadata();
			// Restore visible expected IDs/hashes so rejection must be HMAC-based,
			// not merely a metadata mismatch. Both failed peers lose all access.
			await expect(
				deliver(
					peers.creator,
					await seal(peers.joiner, { ...joinerProof, ...creatorExpected }),
					"confirmation"
				)
			).rejects.toBeInstanceOf(HandshakeError);
			await expect(
				deliver(
					peers.joiner,
					await seal(peers.creator, { ...creatorProof, ...joinerExpected }),
					"confirmation"
				)
			).rejects.toBeInstanceOf(HandshakeError);
			for (const endpoint of [peers.creator, peers.joiner]) {
				expect(endpoint.handshake.state).toBe("failed");
				locked(endpoint);
				expect(() => endpoint.handshake.getSessionMetadata()).toThrow(
					HandshakeError
				);
			}
		}
	});

	test("mixed-body nonce uniqueness", async () => {
		const capture = captureNonces();
		try {
			const peers = await confirmed();
			const bodies: DataBody[] = [
				{ confirmed: false, type: "verification" },
				message,
				{ messageId: "release-message", type: "acknowledgement" },
				{ confirmed: true, type: "verification" },
				message,
				{ type: "end" },
			];
			for (const [sender, receiver] of [
				[peers.creatorSession, peers.joinerSession],
				[peers.joinerSession, peers.creatorSession],
			] as const) {
				const frames = (
					await Promise.all(bodies.map((body) => sender.encrypt(body)))
				).map(value);
				expect(frames.map((frame) => frame.sequence)).toEqual([
					"0",
					"1",
					"2",
					"3",
					"4",
					"5",
				]);
				for (const [index, frame] of frames.entries()) {
					const expectedBody = bodies[index];
					if (!expectedBody) {
						throw new Error("Missing synthetic body");
					}
					expect(value(await receiver.decrypt(frame))).toEqual(expectedBody);
				}
			}
			expect(capture.captured.length).toBe(16); // 4 signaling + 12 mixed data
			const identities = new Set(capture.captured.map((call) => call.identity));
			expect(identities.size).toBe(4); // two protocols, two directions
			expect(
				new Set(capture.captured.map((call) => `${call.identity}:${call.iv}`))
					.size
			).toBe(capture.captured.length);
			for (const protocol of ["glassroom/signaling", "glassroom/data"]) {
				for (const direction of ["creator-to-joiner", "joiner-to-creator"]) {
					const calls = capture.captured.filter(
						(call) => call.protocol === protocol && call.direction === direction
					);
					expect(calls.map((call) => call.sequence)).toEqual(
						protocol === "glassroom/signaling"
							? ["0", "1"]
							: ["0", "1", "2", "3", "4", "5"]
					);
					for (const call of calls) {
						const expected = new Uint8Array(12);
						new DataView(expected.buffer).setBigUint64(
							4,
							BigInt(call.sequence),
							false
						);
						expect(call.iv === base64url(expected)).toBe(true);
					}
				}
			}
		} finally {
			capture.restore();
		}
	});

	test("fresh-room key separation", async () => {
		const capture = captureNonces();
		try {
			const first = await confirmed();
			const oldFrame = value(await first.creatorSession.encrypt(message));
			value(await first.joinerSession.encrypt(message));
			const firstFingerprint = first.creator.handshake.getFingerprint();
			const firstHello = first.creator.handshake.getHello();
			const oldId = first.creator.handshake.getSessionMetadata().sessionId;
			first.creatorSession.dispose();
			first.joinerSession.dispose();
			first.creator.signaling.close();
			first.joiner.signaling.close();
			rejected(
				DataEnvelopeSession.create(first.creator.handshake),
				"invalid_input"
			);
			rejected(await first.creatorSession.encrypt(message), "disposed");
			// Same synthetic secret/new room isolates signaling room-salt separation;
			// the third room also changes the secret, as real teardown must do.
			for (const [room, secret] of [
				[OTHER_ROOM, SECRET],
				[THIRD_ROOM, WRONG_SECRET],
			] as const) {
				const fresh = await confirmed(room, secret);
				expect(
					fresh.creator.handshake.getFingerprint() === firstFingerprint
				).toBe(false);
				expect(
					fresh.creator.handshake.getHello().publicKey === firstHello.publicKey
				).toBe(false);
				expect(
					fresh.creator.handshake.getHello().nonce === firstHello.nonce
				).toBe(false);
				expect(
					fresh.creator.handshake.getSessionMetadata().sessionId === oldId
				).toBe(false);
				for (const [sender, receiver] of [
					[fresh.creatorSession, fresh.joinerSession],
					[fresh.joinerSession, fresh.creatorSession],
				] as const) {
					const frame = value(await sender.encrypt(message));
					expect(frame.sequence).toBe("0");
					expect(value(await receiver.decrypt(frame))).toEqual(message);
				}
				rejected(
					await fresh.joinerSession.decrypt(oldFrame),
					"session_mismatch"
				);
				// Relabeling the old frame cannot authenticate under the fresh key.
				rejected(
					await fresh.joinerSession.decrypt({
						...oldFrame,
						sequence: "1",
						sessionId: fresh.creator.handshake.getSessionMetadata().sessionId,
					}),
					"authentication_failed"
				);
			}
			// All protocols/directions/rooms have different key material, not just
			// different CryptoKey object references or authenticated headers.
			const dataIds = new Set(
				capture.captured
					.filter((call) => call.protocol === "glassroom/data")
					.map((call) => call.identity)
			);
			expect(dataIds.size).toBe(6);
			const signalingIds = new Set(
				capture.captured
					.filter((call) => call.protocol === "glassroom/signaling")
					.map((call) => call.identity)
			);
			expect(signalingIds.size).toBe(6);
			expect(new Set(capture.captured.map((call) => call.identity)).size).toBe(
				12
			);
			expect(
				new Set(capture.captured.map((call) => `${call.identity}:${call.iv}`))
					.size
			).toBe(capture.captured.length);
		} finally {
			capture.restore();
		}
	});

	test("session tamper, reflection, and replay release no body or verification control", async () => {
		const peers = await confirmed();
		for (const body of [
			{ confirmed: true, type: "verification" },
			message,
			{ messageId: "release-message", type: "acknowledgement" },
			{ type: "end" },
		] as const) {
			const forward = value(await peers.creatorSession.encrypt(body));
			const reverse = value(await peers.joinerSession.encrypt(body));
			// Test reflection before genuine receives: it must fail authentication,
			// rather than being rejected incidentally as an already-old sequence.
			rejected(
				await peers.creatorSession.decrypt(forward),
				"authentication_failed"
			);
			rejected(
				await peers.joinerSession.decrypt(reverse),
				"authentication_failed"
			);
			for (const [frame, receiver] of [
				[forward, peers.joinerSession],
				[reverse, peers.creatorSession],
			] as const) {
				rejected(
					await receiver.decrypt(tamper(frame)),
					"authentication_failed"
				);
				rejected(
					await receiver.decrypt({ ...frame, sequence: "999" }),
					"authentication_failed"
				);
				const results = await Promise.all([
					receiver.decrypt(frame),
					receiver.decrypt(frame),
				]);
				expect(value(results[0])).toEqual(body);
				rejected(results[1], "replay_rejected");
			}
		}
	});

	test("4 KiB UTF-8 message limit after confirmed handshake", async () => {
		const peers = await confirmed();
		for (const [sender, receiver] of [
			[peers.creatorSession, peers.joinerSession],
			[peers.joinerSession, peers.creatorSession],
		] as const) {
			for (const text of [
				"x".repeat(MAX_MESSAGE_BYTES),
				"é".repeat(MAX_MESSAGE_BYTES / 2),
				"😀".repeat(MAX_MESSAGE_BYTES / 4),
				"\u0000".repeat(MAX_MESSAGE_BYTES),
			]) {
				expect(encoder.encode(text).byteLength).toBe(4096);
				for (const overLimit of [`${text}x`, `${text}é`]) {
					rejected(
						await sender.encrypt({ ...message, text: overLimit }),
						"invalid_body"
					);
				}
				const body = { ...message, text };
				const frame = value(await sender.encrypt(body));
				expect(
					value(await receiver.decrypt(value(encodeDataEnvelope(frame))))
				).toEqual(body);
			}
		}
	});
});
