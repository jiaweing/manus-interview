/** biome-ignore-all lint/performance/noAwaitInLoops: Small security test matrices intentionally run sequentially for deterministic failure attribution. */
import { describe, expect, test } from "bun:test";
import type {
	HandshakeHello,
	TranscriptConfirmation,
} from "../../apps/web/src/lib/crypto/handshake";
import {
	EphemeralHandshake,
	encodeCanonicalTranscript,
	HandshakeError,
	hashTranscript,
} from "../../apps/web/src/lib/crypto/handshake";

const ROOM = "0123456789abcdef0123456789abcdef";
const OTHER_ROOM = "fedcba9876543210fedcba9876543210";
const encoder = new TextEncoder();
const IV = new Uint8Array(12);
const PLAINTEXT = encoder.encode("unit-test message");
const HEX_PAIR = /../g;
const FINGERPRINT = /^[0-9A-F]{4}( [0-9A-F]{4}){7}$/;
const PUBLIC_KEY = /^04[0-9a-f]{128}$/;

function bytes(value: string): Uint8Array<ArrayBuffer> {
	const octets = value.match(HEX_PAIR);
	if (!octets) {
		throw new Error("Invalid test hex");
	}
	return new Uint8Array(octets.map((octet) => Number.parseInt(octet, 16)));
}

function hex(value: ArrayBuffer): string {
	return Array.from(new Uint8Array(value), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
}

function equal(a: ArrayBuffer, b: ArrayBuffer): boolean {
	return hex(a) === hex(b);
}

function changeHex(value: string): string {
	return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

async function pair(roomId = ROOM) {
	const [creator, joiner] = await Promise.all([
		EphemeralHandshake.create(roomId, "creator"),
		EphemeralHandshake.create(roomId, "joiner"),
	]);
	return { creator, joiner };
}

async function exchange(
	creator: EphemeralHandshake,
	joiner: EphemeralHandshake
) {
	await Promise.all([
		creator.acceptPeer(joiner.getHello()),
		joiner.acceptPeer(creator.getHello()),
	]);
}

async function confirm(
	creator: EphemeralHandshake,
	joiner: EphemeralHandshake
) {
	const [creatorProof, joinerProof] = await Promise.all([
		creator.createConfirmation(),
		joiner.createConfirmation(),
	]);
	await Promise.all([
		creator.acceptConfirmation(joinerProof),
		joiner.acceptConfirmation(creatorProof),
	]);
	return { creatorProof, joinerProof };
}

async function authenticatedPair(roomId = ROOM) {
	const peers = await pair(roomId);
	await exchange(peers.creator, peers.joiner);
	const proofs = await confirm(peers.creator, peers.joiner);
	return { ...peers, ...proofs };
}

async function assertTamperedTranscriptRejected(
	modify: (hello: HandshakeHello) => HandshakeHello
) {
	const { creator, joiner } = await pair();
	await Promise.all([
		creator.acceptPeer(joiner.getHello()),
		joiner.acceptPeer(modify(creator.getHello())),
	]);
	const proof = await joiner.createConfirmation();
	const expected = creator.getSessionMetadata();
	// Force the claimed metadata back to the receiver's expectation. The HMAC
	// must still fail, proving this is not merely an identifier equality check.
	await expect(
		creator.acceptConfirmation({ ...proof, ...expected })
	).rejects.toBeInstanceOf(HandshakeError);
	expect(creator.state).toBe("failed");
	expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
}

describe("ephemeral session handshake", () => {
	test("creator-first canonical transcript", async () => {
		const { creator, joiner } = await pair();
		const c = creator.getHello();
		const j = joiner.getHello();
		const expected = JSON.stringify([
			"glassroom/handshake",
			1,
			ROOM,
			["creator", c.publicKey, c.nonce],
			["joiner", j.publicKey, j.nonce],
		]);
		expect(
			new TextDecoder().decode(encodeCanonicalTranscript(j, c)) === expected
		).toBe(true);
		expect((await hashTranscript(c, j)) === (await hashTranscript(j, c))).toBe(
			true
		);
		await exchange(creator, joiner);
		expect(
			creator.getSessionMetadata().transcriptHash ===
				joiner.getSessionMetadata().transcriptHash
		).toBe(true);
	});

	test("matching fingerprint", async () => {
		const { creator, joiner } = await authenticatedPair();
		expect(creator.state).toBe("authenticated");
		expect(joiner.state).toBe("authenticated");
		expect(creator.getFingerprint() === joiner.getFingerprint()).toBe(true);
		expect(FINGERPRINT.test(creator.getFingerprint())).toBe(true);
		expect(
			creator.getSessionMetadata().sessionId ===
				joiner.getSessionMetadata().sessionId
		).toBe(true);
	});

	test("directional and purpose separation", async () => {
		const { creator, joiner, creatorProof } = await authenticatedPair();
		const c = creator.getSessionKeys();
		const j = joiner.getSessionKeys();
		const forward = await crypto.subtle.encrypt(
			{ iv: IV, name: "AES-GCM" },
			c.send,
			PLAINTEXT
		);
		const reverse = await crypto.subtle.encrypt(
			{ iv: IV, name: "AES-GCM" },
			j.send,
			PLAINTEXT
		);
		expect(equal(forward, reverse)).toBe(false);
		expect(
			equal(
				await crypto.subtle.decrypt(
					{ iv: IV, name: "AES-GCM" },
					j.receive,
					forward
				),
				PLAINTEXT.buffer
			)
		).toBe(true);
		expect(
			equal(
				await crypto.subtle.decrypt(
					{ iv: IV, name: "AES-GCM" },
					c.receive,
					reverse
				),
				PLAINTEXT.buffer
			)
		).toBe(true);
		await expect(
			crypto.subtle.decrypt({ iv: IV, name: "AES-GCM" }, c.receive, forward)
		).rejects.toThrow();
		// Reflection cannot masquerade as the opposite directional HMAC.
		await expect(
			creator.acceptConfirmation({ ...creatorProof, role: "joiner" })
		).rejects.toBeInstanceOf(HandshakeError);

		// Independently reproduce HKDF with a test-owned peer key. This exercises
		// every distinct purpose label without exposing production key material.
		const local = await EphemeralHandshake.create(ROOM, "creator");
		const peerKeys = await crypto.subtle.generateKey(
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			["deriveBits"]
		);
		const peer: HandshakeHello = {
			nonce: hex(crypto.getRandomValues(new Uint8Array(32)).buffer),
			publicKey: hex(await crypto.subtle.exportKey("raw", peerKeys.publicKey)),
			role: "joiner",
			roomId: ROOM,
			version: 1,
		};
		const localPublic = await crypto.subtle.importKey(
			"raw",
			bytes(local.getHello().publicKey),
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			[]
		);
		const secret = await crypto.subtle.deriveBits(
			{ name: "ECDH", public: localPublic },
			peerKeys.privateKey,
			256
		);
		const root = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
			"deriveKey",
			"deriveBits",
		]);
		new Uint8Array(secret).fill(0);
		await local.acceptPeer(peer);
		const metadata = local.getSessionMetadata();
		const params = (purpose: string): HkdfParams => ({
			hash: "SHA-256",
			info: encoder.encode(`glassroom/session/v1/${purpose}`),
			name: "HKDF",
			salt: bytes(metadata.transcriptHash),
		});
		const purposes = [
			"data/creator-to-joiner",
			"data/joiner-to-creator",
			"confirmation/creator-to-joiner",
			"confirmation/joiner-to-creator",
			"fingerprint",
			"session-id",
		];
		const materials = await Promise.all(
			purposes.map((purpose) =>
				crypto.subtle.deriveBits(params(purpose), root, 256)
			)
		);
		expect(new Set(materials.map(hex)).size).toBe(purposes.length);
		const hmac = await crypto.subtle.deriveKey(
			params("confirmation/joiner-to-creator"),
			root,
			{ hash: "SHA-256", length: 256, name: "HMAC" },
			false,
			["sign"]
		);
		const body = encoder.encode(
			JSON.stringify([
				"glassroom/transcript-confirmation",
				1,
				metadata.sessionId,
				"joiner",
				metadata.transcriptHash,
			])
		);
		await local.acceptConfirmation({
			version: 1,
			...metadata,
			mac: hex(await crypto.subtle.sign("HMAC", hmac, body)),
			role: "joiner",
		});
		const proof = await local.createConfirmation();
		const cHmac = await crypto.subtle.deriveKey(
			params("confirmation/creator-to-joiner"),
			root,
			{ hash: "SHA-256", length: 256, name: "HMAC" },
			false,
			["verify"]
		);
		const cBody = encoder.encode(
			JSON.stringify([
				"glassroom/transcript-confirmation",
				1,
				metadata.sessionId,
				"creator",
				metadata.transcriptHash,
			])
		);
		expect(
			await crypto.subtle.verify("HMAC", cHmac, bytes(proof.mac), cBody)
		).toBe(true);
		const expectedKey = await crypto.subtle.deriveKey(
			params("data/creator-to-joiner"),
			root,
			{ length: 256, name: "AES-GCM" },
			false,
			["encrypt"]
		);
		expect(
			equal(
				await crypto.subtle.encrypt(
					{ iv: IV, name: "AES-GCM" },
					expectedKey,
					PLAINTEXT
				),
				await crypto.subtle.encrypt(
					{ iv: IV, name: "AES-GCM" },
					local.getSessionKeys().send,
					PLAINTEXT
				)
			)
		).toBe(true);
		// Treating the confirmation material as an AES key must not yield the data ciphertext.
		const wrongPurposeKey = await crypto.subtle.deriveKey(
			params("confirmation/creator-to-joiner"),
			root,
			{ length: 256, name: "AES-GCM" },
			false,
			["encrypt"]
		);
		expect(
			equal(
				await crypto.subtle.encrypt(
					{ iv: IV, name: "AES-GCM" },
					wrongPurposeKey,
					PLAINTEXT
				),
				await crypto.subtle.encrypt(
					{ iv: IV, name: "AES-GCM" },
					expectedKey,
					PLAINTEXT
				)
			)
		).toBe(false);
		for (const material of materials) {
			new Uint8Array(material).fill(0);
		}
	});

	test("room binding", async () => {
		const { creator, joiner } = await pair();
		const c = creator.getHello();
		const j = joiner.getHello();
		expect(
			(await hashTranscript(c, j)) ===
				(await hashTranscript(
					{ ...c, roomId: OTHER_ROOM },
					{ ...j, roomId: OTHER_ROOM }
				))
		).toBe(false);
		await expect(
			creator.acceptPeer({ ...j, roomId: OTHER_ROOM })
		).rejects.toBeInstanceOf(HandshakeError);
		expect(creator.state).toBe("failed");
		const a = await pair();
		const b = await authenticatedPair(OTHER_ROOM);
		await exchange(a.creator, a.joiner);
		await expect(
			a.creator.acceptConfirmation({
				...b.joinerProof,
				...a.creator.getSessionMetadata(),
			})
		).rejects.toBeInstanceOf(HandshakeError);
	});

	test("role binding", async () => {
		const { creator, joiner } = await pair();
		const c = creator.getHello();
		const j = joiner.getHello();
		expect(
			(await hashTranscript(c, j)) ===
				(await hashTranscript(
					{ ...c, role: "joiner" },
					{ ...j, role: "creator" }
				))
		).toBe(false);
		await expect(
			creator.acceptPeer({ ...j, role: "creator" })
		).rejects.toBeInstanceOf(HandshakeError);
		const peers = await pair();
		await exchange(peers.creator, peers.joiner);
		const proof = await peers.joiner.createConfirmation();
		await expect(
			peers.creator.acceptConfirmation({ ...proof, role: "creator" })
		).rejects.toBeInstanceOf(HandshakeError);
	});

	test("public-key binding", async () => {
		const replacement = await EphemeralHandshake.create(ROOM, "creator");
		await assertTamperedTranscriptRejected((hello) => ({
			...hello,
			publicKey: replacement.getHello().publicKey,
		}));
	});

	test("nonce binding", async () => {
		await assertTamperedTranscriptRejected((hello) => ({
			...hello,
			nonce: changeHex(hello.nonce),
		}));
	});

	test("invalid HMAC", async () => {
		const { creator, joiner } = await pair();
		await exchange(creator, joiner);
		const proof = await joiner.createConfirmation();
		await creator.createConfirmation();
		await expect(
			creator.acceptConfirmation({ ...proof, mac: changeHex(proof.mac) })
		).rejects.toBeInstanceOf(HandshakeError);
		expect(creator.state).toBe("failed");
		expect(() => creator.getFingerprint()).toThrow(HandshakeError);
		expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
	});

	test("fresh session material", async () => {
		const a = await authenticatedPair();
		const b = await authenticatedPair();
		for (const role of ["creator", "joiner"] as const) {
			expect(
				a[role].getHello().publicKey === b[role].getHello().publicKey
			).toBe(false);
			expect(a[role].getHello().nonce === b[role].getHello().nonce).toBe(false);
			const first = await crypto.subtle.encrypt(
				{ iv: IV, name: "AES-GCM" },
				a[role].getSessionKeys().send,
				PLAINTEXT
			);
			const second = await crypto.subtle.encrypt(
				{ iv: IV, name: "AES-GCM" },
				b[role].getSessionKeys().send,
				PLAINTEXT
			);
			expect(equal(first, second)).toBe(false);
		}
		expect(
			a.creator.getSessionMetadata().sessionId ===
				b.creator.getSessionMetadata().sessionId
		).toBe(false);
		expect(a.creator.getFingerprint() === b.creator.getFingerprint()).toBe(
			false
		);
	});

	test("no private material in envelopes", async () => {
		const { creator, joiner, creatorProof, joinerProof } =
			await authenticatedPair();
		for (const peer of [creator, joiner]) {
			const hello = peer.getHello();
			expect(Object.keys(JSON.parse(JSON.stringify(hello))).sort()).toEqual([
				"nonce",
				"publicKey",
				"role",
				"roomId",
				"version",
			]);
			expect(PUBLIC_KEY.test(hello.publicKey)).toBe(true);
			expect(Object.keys(peer)).toEqual([]);
			expect(JSON.stringify(peer)).toBe("{}");
			const keys = peer.getSessionKeys();
			for (const key of [keys.send, keys.receive]) {
				expect(key.extractable).toBe(false);
				expect(key.algorithm.name).toBe("AES-GCM");
				expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
				await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
			}
			expect(keys.send.usages).toEqual(["encrypt"]);
			expect(keys.receive.usages).toEqual(["decrypt"]);
		}
		for (const proof of [creatorProof, joinerProof]) {
			expect(Object.keys(JSON.parse(JSON.stringify(proof))).sort()).toEqual([
				"mac",
				"role",
				"sessionId",
				"transcriptHash",
				"version",
			]);
		}
	});

	test("both local and peer confirmations are required", async () => {
		const { creator, joiner } = await pair();
		await exchange(creator, joiner);
		expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
		expect(() => creator.getFingerprint()).toThrow(HandshakeError);
		const jProof = await joiner.createConfirmation();
		expect(joiner.state).toBe("confirming");
		await creator.acceptConfirmation(jProof);
		expect(creator.state).toBe("confirming");
		expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
		const cProof = await creator.createConfirmation();
		expect(creator.state).toBe("authenticated");
		expect(joiner.state).toBe("confirming");
		await joiner.acceptConfirmation(cProof);
		expect(joiner.state).toBe("authenticated");
	});

	test("malformed and unknown envelope fields fail closed", async () => {
		const { joiner } = await pair();
		const good = joiner.getHello();
		const badHellos: unknown[] = [
			null,
			[],
			{ ...good, privateKey: "forbidden" },
			{ ...good, version: 2 },
			{ ...good, nonce: "00" },
			{ ...good, role: "observer" },
			{ ...good, publicKey: `04${"00".repeat(64)}` },
		];
		for (const hello of badHellos) {
			const creator = await EphemeralHandshake.create(ROOM, "creator");
			await expect(creator.acceptPeer(hello)).rejects.toBeInstanceOf(
				HandshakeError
			);
			expect(creator.state).toBe("failed");
		}
		const mutations: ((proof: TranscriptConfirmation) => unknown)[] = [
			() => null,
			(proof) => ({ ...proof, secret: "forbidden" }),
			(proof) => ({ ...proof, mac: "00" }),
			(proof) => ({ ...proof, version: 2 }),
			(proof) => ({ ...proof, sessionId: changeHex(proof.sessionId) }),
			(proof) => ({
				...proof,
				transcriptHash: changeHex(proof.transcriptHash),
			}),
		];
		for (const mutate of mutations) {
			const peers = await pair();
			await exchange(peers.creator, peers.joiner);
			await expect(
				peers.creator.acceptConfirmation(
					mutate(await peers.joiner.createConfirmation())
				)
			).rejects.toBeInstanceOf(HandshakeError);
			expect(peers.creator.state).toBe("failed");
		}
	});

	test("one-shot derivation, copied envelopes, and teardown", async () => {
		const { creator, joiner } = await pair();
		const copy = creator.getHello();
		copy.nonce = "00".repeat(32);
		expect(creator.getHello().nonce === copy.nonce).toBe(false);
		await exchange(creator, joiner);
		await expect(creator.acceptPeer(joiner.getHello())).rejects.toBeInstanceOf(
			HandshakeError
		);
		await confirm(creator, joiner);
		creator.destroy();
		expect(creator.state).toBe("destroyed");
		expect(() => creator.getHello()).toThrow(HandshakeError);
		expect(() => creator.getSessionMetadata()).toThrow(HandshakeError);
		expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
		await expect(creator.createConfirmation()).rejects.toBeInstanceOf(
			HandshakeError
		);
		creator.destroy();
		expect(creator.state).toBe("destroyed");
	});

	test("teardown cannot resurrect an in-flight handshake", async () => {
		const { creator, joiner } = await pair();
		const pending = creator.acceptPeer(joiner.getHello());
		creator.destroy();
		await expect(pending).rejects.toBeInstanceOf(HandshakeError);
		expect(creator.state).toBe("destroyed");
		expect(() => creator.getSessionKeys()).toThrow(HandshakeError);
	});
});
