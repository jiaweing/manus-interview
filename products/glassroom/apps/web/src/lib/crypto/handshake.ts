/** biome-ignore-all lint/style/useErrorCause: PRD requires redacted crypto errors, never engine error causes. */
/**
 * Browser-memory-only P-256 handshake (PRD §9).
 *
 * Send only getHello() and createConfirmation() through authenticated encrypted
 * signaling. `authenticated` means mutual transcript/key confirmation, NOT human
 * identity verification: callers must still compare and mutually confirm the
 * fingerprint out-of-band before enabling chat. Discard this instance on room
 * termination; there is no resumption. JS cannot guarantee physical key erasure.
 */
export type ParticipantRole = "creator" | "joiner";
export type HandshakeState =
	| "new"
	| "deriving"
	| "confirming"
	| "authenticated"
	| "failed"
	| "destroyed";

export interface HandshakeHello {
	/** Fresh 256-bit public participant nonce, lowercase hex. */
	nonce: string;
	/** Uncompressed SEC1 P-256 public key, lowercase hex (65 bytes). */
	publicKey: string;
	role: ParticipantRole;
	roomId: string;
	version: 1;
}

export interface TranscriptConfirmation {
	mac: string;
	role: ParticipantRole;
	sessionId: string;
	transcriptHash: string;
	version: 1;
}

export interface SessionKeys {
	receive: CryptoKey;
	/** Non-extractable AES-256-GCM keys; never put these in an envelope. */
	send: CryptoKey;
}

interface DerivedSession {
	confirmationReceive: CryptoKey;
	confirmationSend: CryptoKey;
	fingerprint: string;
	keys: SessionKeys;
	sessionId: string;
	transcriptHash: string;
}

const encoder = new TextEncoder();
const PUBLIC_KEY_HEX = /^04[0-9a-f]{128}$/;
const NONCE_HEX = /^[0-9a-f]{64}$/;
const ID_HEX = /^[0-9a-f]{32}$/;
const ROOM_ID = /^[A-Za-z0-9_-]+$/;
const FINGERPRINT_GROUP = /.{4}/g;
const HELLO_FIELDS = ["nonce", "publicKey", "role", "roomId", "version"];
const CONFIRMATION_FIELDS = [
	"mac",
	"role",
	"sessionId",
	"transcriptHash",
	"version",
];

export class HandshakeError extends Error {
	constructor() {
		super("Handshake rejected");
		this.name = "HandshakeError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: string[]) {
	return Object.keys(value).sort().join(",") === fields.join(",");
}

function isRole(value: unknown): value is ParticipantRole {
	return value === "creator" || value === "joiner";
}

function validRoom(roomId: unknown): roomId is string {
	return (
		typeof roomId === "string" &&
		roomId.length > 0 &&
		roomId.length <= 128 &&
		ROOM_ID.test(roomId)
	);
}

function parseHello(value: unknown): HandshakeHello {
	if (
		!(isRecord(value) && hasExactFields(value, HELLO_FIELDS)) ||
		value.version !== 1 ||
		!validRoom(value.roomId) ||
		!isRole(value.role) ||
		typeof value.publicKey !== "string" ||
		!PUBLIC_KEY_HEX.test(value.publicKey) ||
		typeof value.nonce !== "string" ||
		!NONCE_HEX.test(value.nonce)
	) {
		throw new HandshakeError();
	}
	return {
		nonce: value.nonce,
		publicKey: value.publicKey,
		role: value.role,
		roomId: value.roomId,
		version: 1,
	};
}

function parseConfirmation(value: unknown): TranscriptConfirmation {
	if (
		!(isRecord(value) && hasExactFields(value, CONFIRMATION_FIELDS)) ||
		value.version !== 1 ||
		!isRole(value.role) ||
		typeof value.sessionId !== "string" ||
		!ID_HEX.test(value.sessionId) ||
		typeof value.transcriptHash !== "string" ||
		!NONCE_HEX.test(value.transcriptHash) ||
		typeof value.mac !== "string" ||
		!NONCE_HEX.test(value.mac)
	) {
		throw new HandshakeError();
	}
	return {
		mac: value.mac,
		role: value.role,
		sessionId: value.sessionId,
		transcriptHash: value.transcriptHash,
		version: 1,
	};
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
}

function unhex(value: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(value.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function opposite(role: ParticipantRole): ParticipantRole {
	return role === "creator" ? "joiner" : "creator";
}

/** Fixed JSON-array schema, UTF-8 encoded; arrival order cannot change the hash. */
export function encodeCanonicalTranscript(
	first: HandshakeHello,
	second: HandshakeHello
): Uint8Array<ArrayBuffer> {
	const a = parseHello(first);
	const b = parseHello(second);
	if (a.roomId !== b.roomId || a.role === b.role) {
		throw new HandshakeError();
	}
	const creator = a.role === "creator" ? a : b;
	const joiner = a.role === "joiner" ? a : b;
	return encoder.encode(
		JSON.stringify([
			"glassroom/handshake",
			1,
			creator.roomId,
			[creator.role, creator.publicKey, creator.nonce],
			[joiner.role, joiner.publicKey, joiner.nonce],
		])
	);
}

export async function hashTranscript(
	first: HandshakeHello,
	second: HandshakeHello
): Promise<string> {
	return hex(
		await crypto.subtle.digest(
			"SHA-256",
			encodeCanonicalTranscript(first, second)
		)
	);
}

function confirmationBody(
	session: DerivedSession,
	role: ParticipantRole
): Uint8Array<ArrayBuffer> {
	return encoder.encode(
		JSON.stringify([
			"glassroom/transcript-confirmation",
			1,
			session.sessionId,
			role,
			session.transcriptHash,
		])
	);
}

async function deriveSession(
	privateKey: CryptoKey,
	local: HandshakeHello,
	peer: HandshakeHello
): Promise<DerivedSession> {
	const peerKey = await crypto.subtle.importKey(
		"raw",
		unhex(peer.publicKey),
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[]
	);
	const secret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: peerKey },
			privateKey,
			256
		)
	);
	try {
		const root = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
			"deriveKey",
			"deriveBits",
		]);
		const transcriptHash = await hashTranscript(local, peer);
		const params = (purpose: string): HkdfParams => ({
			hash: "SHA-256",
			info: encoder.encode(`glassroom/session/v1/${purpose}`),
			name: "HKDF",
			salt: unhex(transcriptHash),
		});
		const direction = (role: ParticipantRole) => `${role}-to-${opposite(role)}`;
		const aes = (role: ParticipantRole, usage: "encrypt" | "decrypt") =>
			crypto.subtle.deriveKey(
				params(`data/${direction(role)}`),
				root,
				{ length: 256, name: "AES-GCM" },
				false,
				[usage]
			);
		const hmac = (role: ParticipantRole, usage: "sign" | "verify") =>
			crypto.subtle.deriveKey(
				params(`confirmation/${direction(role)}`),
				root,
				{ hash: "SHA-256", length: 256, name: "HMAC" },
				false,
				[usage]
			);
		const [send, receive, confirmationSend, confirmationReceive, id, sas] =
			await Promise.all([
				aes(local.role, "encrypt"),
				aes(peer.role, "decrypt"),
				hmac(local.role, "sign"),
				hmac(peer.role, "verify"),
				crypto.subtle.deriveBits(params("session-id"), root, 128),
				crypto.subtle.deriveBits(params("fingerprint"), root, 128),
			]);
		const fingerprint = hex(sas)
			.toUpperCase()
			.match(FINGERPRINT_GROUP)
			?.join(" ");
		if (!fingerprint) {
			throw new HandshakeError();
		}
		return {
			confirmationReceive,
			confirmationSend,
			fingerprint,
			keys: { receive, send },
			sessionId: hex(id),
			transcriptHash,
		};
	} finally {
		// Best effort: CryptoKeys and engine copies are outside JS erasure control.
		secret.fill(0);
	}
}

export class EphemeralHandshake {
	readonly #hello: HandshakeHello;
	#keyPair: CryptoKeyPair | undefined;
	#session: DerivedSession | undefined;
	#state: HandshakeState = "new";
	#localConfirmed = false;
	#peerConfirmed = false;

	private constructor(hello: HandshakeHello, keyPair: CryptoKeyPair) {
		this.#hello = hello;
		this.#keyPair = keyPair;
	}

	static async create(
		roomId: string,
		role: ParticipantRole
	): Promise<EphemeralHandshake> {
		if (!(validRoom(roomId) && isRole(role))) {
			throw new HandshakeError();
		}
		try {
			const keyPair = await crypto.subtle.generateKey(
				{ name: "ECDH", namedCurve: "P-256" },
				false,
				["deriveBits"]
			);
			return new EphemeralHandshake(
				{
					nonce: hex(crypto.getRandomValues(new Uint8Array(32))),
					publicKey: hex(
						await crypto.subtle.exportKey("raw", keyPair.publicKey)
					),
					role,
					roomId,
					version: 1,
				},
				keyPair
			);
		} catch {
			throw new HandshakeError();
		}
	}

	get state(): HandshakeState {
		return this.#state;
	}

	getHello(): HandshakeHello {
		if (this.#state === "failed" || this.#state === "destroyed") {
			throw new HandshakeError();
		}
		return { ...this.#hello };
	}

	async acceptPeer(value: unknown): Promise<void> {
		if (this.#state !== "new" || !this.#keyPair) {
			throw new HandshakeError();
		}
		this.#state = "deriving";
		try {
			const peer = parseHello(value);
			if (
				peer.roomId !== this.#hello.roomId ||
				peer.role !== opposite(this.#hello.role)
			) {
				throw new HandshakeError();
			}
			const session = await deriveSession(
				this.#keyPair.privateKey,
				this.#hello,
				peer
			);
			if (this.state !== "deriving") {
				throw new HandshakeError();
			}
			this.#session = session;
			this.#keyPair = undefined;
			this.#state = "confirming";
		} catch {
			this.#fail();
			throw new HandshakeError();
		}
	}

	#ready(): DerivedSession {
		if (
			!this.#session ||
			(this.#state !== "confirming" && this.#state !== "authenticated")
		) {
			throw new HandshakeError();
		}
		return this.#session;
	}

	#advance() {
		// biome-ignore lint/suspicious/noUnnecessaryConditions: Both private flags are set true by the async confirmation methods; Biome infers only their initializers.
		if (this.#localConfirmed && this.#peerConfirmed) {
			this.#state = "authenticated";
		}
	}

	async createConfirmation(): Promise<TranscriptConfirmation> {
		const session = this.#ready();
		try {
			const mac = await crypto.subtle.sign(
				"HMAC",
				session.confirmationSend,
				confirmationBody(session, this.#hello.role)
			);
			this.#ready();
			this.#localConfirmed = true;
			this.#advance();
			return {
				mac: hex(mac),
				role: this.#hello.role,
				sessionId: session.sessionId,
				transcriptHash: session.transcriptHash,
				version: 1,
			};
		} catch {
			this.#fail();
			throw new HandshakeError();
		}
	}

	async acceptConfirmation(value: unknown): Promise<void> {
		const session = this.#ready();
		try {
			const proof = parseConfirmation(value);
			if (
				proof.role !== opposite(this.#hello.role) ||
				proof.sessionId !== session.sessionId ||
				proof.transcriptHash !== session.transcriptHash ||
				!(await crypto.subtle.verify(
					"HMAC",
					session.confirmationReceive,
					unhex(proof.mac),
					confirmationBody(session, proof.role)
				))
			) {
				throw new HandshakeError();
			}
			this.#ready();
			this.#peerConfirmed = true;
			this.#advance();
		} catch {
			this.#fail();
			throw new HandshakeError();
		}
	}

	/** Public metadata, available for the confirmation exchange; contains no keys. */
	getSessionMetadata(): { sessionId: string; transcriptHash: string } {
		const session = this.#ready();
		return {
			sessionId: session.sessionId,
			transcriptHash: session.transcriptHash,
		};
	}

	getFingerprint(): string {
		if (this.#state !== "authenticated") {
			throw new HandshakeError();
		}
		return this.#ready().fingerprint;
	}

	getSessionKeys(): SessionKeys {
		if (this.#state !== "authenticated") {
			throw new HandshakeError();
		}
		return { ...this.#ready().keys };
	}

	#fail() {
		if (this.#state !== "destroyed") {
			this.#state = "failed";
		}
		this.#keyPair = undefined;
		this.#session = undefined;
		this.#localConfirmed = false;
		this.#peerConfirmed = false;
	}

	/** Drop owned key references. Callers must also discard any retrieved keys. */
	destroy(): void {
		this.#state = "destroyed";
		this.#fail();
	}
}
