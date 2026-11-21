import { z } from "zod";

export const SIGNALING_VERSION = 1;
export const MAX_SIGNALING_COUNTER = BigInt("18446744073709551615");
export const MAX_SIGNALING_PLAINTEXT_BYTES = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = MAX_SIGNALING_PLAINTEXT_BYTES + 16;
const MAX_ENVELOPE_BYTES = Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3) + 256;
const encoder = new TextEncoder();
const BASE64_PADDING_REGEX = /[=]+$/;
const COUNTER_REGEX = /^(0|[1-9][0-9]{0,19})$/;

export type SignalingRole = "creator" | "joiner";
export type SignalingFailure =
	| "invalid_input"
	| "crypto_unavailable"
	| "invalid_envelope"
	| "context_mismatch"
	| "authentication_failed"
	| "replay_rejected"
	| "counter_exhausted"
	| "encryption_failed"
	| "closed";
export type CryptoResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: SignalingFailure };

function failure(error: SignalingFailure): CryptoResult<never> {
	return { error, ok: false };
}

function encodeBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(BASE64_PADDING_REGEX, "");
}

function decodeBase64url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalBase64url(text: string): boolean {
	try {
		return encodeBase64url(decodeBase64url(text)) === text;
	} catch {
		return false;
	}
}

const roomIdSchema = z
	.string()
	.length(22)
	.regex(/^[A-Za-z0-9_-]{22}$/)
	.refine((value) => value.length === 22 && canonicalBase64url(value));
const roleSchema = z.enum(["creator", "joiner"]);
const counterSchema = z
	.string()
	.regex(COUNTER_REGEX)
	.refine(
		(value) =>
			COUNTER_REGEX.test(value) && BigInt(value) <= MAX_SIGNALING_COUNTER
	);
const ciphertextSchema = z
	.string()
	.min(22)
	.max(Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3))
	.regex(/^[A-Za-z0-9_-]+$/)
	.refine((value) => {
		if (
			value.length < 22 ||
			value.length > Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3) ||
			!canonicalBase64url(value)
		) {
			return false;
		}
		const length = decodeBase64url(value).byteLength;
		return length >= 16 && length <= MAX_CIPHERTEXT_BYTES;
	});

/** Wire counters are canonical decimal strings, never lossy JS numbers. */
export const signalingEnvelopeSchema = z.strictObject({
	ciphertext: ciphertextSchema,
	counter: counterSchema,
	operation: z.literal("forward"),
	role: roleSchema,
	roomId: roomIdSchema,
	version: z.literal(SIGNALING_VERSION),
});
export type SignalingEnvelope = z.infer<typeof signalingEnvelopeSchema>;

/** Zod errors and JSON parse errors never leave this boundary. */
export function decodeSignalingEnvelope(
	input: unknown
): CryptoResult<SignalingEnvelope> {
	try {
		if (typeof input === "string" && input.length > MAX_ENVELOPE_BYTES) {
			return failure("invalid_envelope");
		}
		const parsed = signalingEnvelopeSchema.safeParse(
			typeof input === "string" ? JSON.parse(input) : input
		);
		return parsed.success
			? { ok: true, value: parsed.data }
			: failure("invalid_envelope");
	} catch {
		return failure("invalid_envelope");
	}
}

export function encodeSignalingEnvelope(input: unknown): CryptoResult<string> {
	const parsed = decodeSignalingEnvelope(input);
	return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value) } : parsed;
}

export interface SignalingKeys {
	creatorToJoiner: CryptoKey;
	joinerToCreator: CryptoKey;
}

/** The secret is exactly 32 bytes; the room ID is canonical base64url of 16 bytes. */
export async function deriveSignalingKeys(
	invitationSecret: Uint8Array,
	roomId: string
): Promise<CryptoResult<SignalingKeys>> {
	if (
		!(invitationSecret instanceof Uint8Array) ||
		invitationSecret.byteLength !== 32
	) {
		return failure("invalid_input");
	}
	if (!roomIdSchema.safeParse(roomId).success) {
		return failure("invalid_input");
	}
	if (!globalThis.crypto?.subtle) {
		return failure("crypto_unavailable");
	}
	const secret = Uint8Array.from(invitationSecret);
	try {
		const material = await crypto.subtle.importKey(
			"raw",
			secret,
			"HKDF",
			false,
			["deriveKey"]
		);
		const salt = decodeBase64url(roomId);
		const derive = (direction: string) =>
			crypto.subtle.deriveKey(
				{
					hash: "SHA-256",
					info: encoder.encode(`glassroom/signaling/v1/${direction}`),
					name: "HKDF",
					salt,
				},
				material,
				{ length: 256, name: "AES-GCM" },
				false,
				["encrypt", "decrypt"]
			);
		const [creatorToJoiner, joinerToCreator] = await Promise.all([
			derive("creator-to-joiner"),
			derive("joiner-to-creator"),
		]);
		return { ok: true, value: { creatorToJoiner, joinerToCreator } };
	} catch {
		return failure("crypto_unavailable");
	} finally {
		secret.fill(0);
	}
}

function nonce(counter: bigint): Uint8Array<ArrayBuffer> {
	const iv = new Uint8Array(12);
	new DataView(iv.buffer).setBigUint64(4, counter, false);
	return iv;
}

function additionalData(
	envelope: Omit<SignalingEnvelope, "ciphertext">
): Uint8Array<ArrayBuffer> {
	// Fixed-position JSON array is the canonical authenticated header, including direction and counter.
	return encoder.encode(
		JSON.stringify([
			"glassroom/signaling",
			envelope.version,
			envelope.roomId,
			envelope.role,
			envelope.operation,
			envelope.counter,
		])
	);
}

function validateIncomingCounter(
	envelope: SignalingEnvelope,
	roomId: string,
	peerRole: SignalingRole,
	acceptedIncoming: bigint | null,
	counterLimit: bigint
): CryptoResult<bigint> {
	if (envelope.roomId !== roomId || envelope.role !== peerRole) {
		return failure("context_mismatch");
	}
	const counter = BigInt(envelope.counter);
	if (acceptedIncoming !== null && counter <= acceptedIncoming) {
		return failure("replay_rejected");
	}
	if (counter > counterLimit) {
		// An unauthenticated high counter must not close the session or change state.
		return failure("counter_exhausted");
	}
	return { ok: true, value: counter };
}

export interface SignalingCrypto {
	close: () => void;
	readonly closed: boolean;
	decrypt: (
		envelope: unknown
	) => Promise<CryptoResult<Uint8Array<ArrayBuffer>>>;
	encrypt: (plaintext: Uint8Array) => Promise<CryptoResult<SignalingEnvelope>>;
}

export interface SignalingCryptoOptions {
	/** Optional conservative cap for testing/early rotation. Cannot exceed uint64; never seeds state. */
	counterLimit?: bigint;
	invitationSecret: Uint8Array;
	role: SignalingRole;
	roomId: string;
}

/**
 * One memory-only instance per role and fresh room. No restore/reconnect support.
 * Recreating an instance for the same invitation would reset nonces: create a fresh
 * room/secret after teardown. Call close() on transport loss to drop key references.
 */
export async function createSignalingCrypto(
	options: SignalingCryptoOptions
): Promise<CryptoResult<SignalingCrypto>> {
	const { roomId, role, counterLimit = MAX_SIGNALING_COUNTER } = options;
	if (
		!roleSchema.safeParse(role).success ||
		typeof counterLimit !== "bigint" ||
		counterLimit < BigInt(0) ||
		counterLimit > MAX_SIGNALING_COUNTER
	) {
		return failure("invalid_input");
	}
	const derived = await deriveSignalingKeys(options.invitationSecret, roomId);
	if (!derived.ok) {
		return derived;
	}
	let sendKey: CryptoKey | null =
		role === "creator"
			? derived.value.creatorToJoiner
			: derived.value.joinerToCreator;
	let receiveKey: CryptoKey | null =
		role === "creator"
			? derived.value.joinerToCreator
			: derived.value.creatorToJoiner;
	const peerRole: SignalingRole = role === "creator" ? "joiner" : "creator";
	let outgoing = BigInt(0);
	let acceptedIncoming: bigint | null = null;
	let isClosed = false;
	let sends: Promise<unknown> = Promise.resolve();
	let receives: Promise<unknown> = Promise.resolve();

	const close = () => {
		isClosed = true;
		sendKey = null;
		receiveKey = null;
		acceptedIncoming = null;
	};

	const encrypt = (
		plaintext: Uint8Array
	): Promise<CryptoResult<SignalingEnvelope>> => {
		// Snapshot at invocation, before queued work can observe caller mutation.
		const bytes =
			plaintext instanceof Uint8Array &&
			plaintext.byteLength <= MAX_SIGNALING_PLAINTEXT_BYTES
				? Uint8Array.from(plaintext)
				: null;
		const run = async (): Promise<CryptoResult<SignalingEnvelope>> => {
			if (isClosed || !sendKey) {
				return failure("closed");
			}
			if (!bytes) {
				return failure("invalid_input");
			}
			if (outgoing > counterLimit) {
				close();
				return failure("counter_exhausted");
			}
			const counter = outgoing;
			// Reserve before WebCrypto, including failed sends. No nonce can be reused.
			outgoing += BigInt(1);
			const header: Omit<SignalingEnvelope, "ciphertext"> = {
				counter: counter.toString(),
				operation: "forward",
				role,
				roomId,
				version: SIGNALING_VERSION,
			};
			try {
				const encrypted = await crypto.subtle.encrypt(
					{
						additionalData: additionalData(header),
						iv: nonce(counter),
						name: "AES-GCM",
						tagLength: 128,
					},
					sendKey,
					bytes
				);
				if (isClosed) {
					return failure("closed");
				}
				return {
					ok: true,
					value: {
						...header,
						ciphertext: encodeBase64url(new Uint8Array(encrypted)),
					},
				};
			} catch {
				close();
				return failure("encryption_failed");
			}
		};
		const result = sends
			.then(run)
			.catch(() => {
				close();
				return failure("encryption_failed");
			})
			.finally(() => bytes?.fill(0));
		sends = result.then(() => undefined);
		return result;
	};

	const decrypt = (
		input: unknown
	): Promise<CryptoResult<Uint8Array<ArrayBuffer>>> => {
		// Validate/snapshot at invocation; never expose raw input or validation issues.
		const parsed = decodeSignalingEnvelope(input);
		const run = async (): Promise<CryptoResult<Uint8Array<ArrayBuffer>>> => {
			if (isClosed || !receiveKey) {
				return failure("closed");
			}
			if (!parsed.ok) {
				return parsed;
			}
			const envelope = parsed.value;
			const validatedCounter = validateIncomingCounter(
				envelope,
				roomId,
				peerRole,
				acceptedIncoming,
				counterLimit
			);
			if (!validatedCounter.ok) {
				return validatedCounter;
			}
			const counter = validatedCounter.value;
			try {
				const decrypted = await crypto.subtle.decrypt(
					{
						additionalData: additionalData(envelope),
						iv: nonce(counter),
						name: "AES-GCM",
						tagLength: 128,
					},
					receiveKey,
					decodeBase64url(envelope.ciphertext)
				);
				const bytes = new Uint8Array(decrypted);
				if (isClosed) {
					bytes.fill(0);
					return failure("closed");
				}
				// Receive state changes only after authenticated decryption, within the queue.
				acceptedIncoming = counter;
				return { ok: true, value: bytes };
			} catch {
				return failure("authentication_failed");
			}
		};
		const result = receives
			.then(run)
			.catch(() => failure("authentication_failed"));
		// Do not retain the last plaintext in the queue's settled promise.
		receives = result.then(() => undefined);
		return result;
	};

	return {
		ok: true,
		value: {
			close,
			get closed() {
				return isClosed;
			},
			decrypt,
			encrypt,
		},
	};
}
