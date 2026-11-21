import { z } from "zod";
import {
	EphemeralHandshake,
	type ParticipantRole,
	type SessionKeys,
} from "./handshake";

export const MAX_DATA_SEQUENCE = BigInt("18446744073709551615");
export const MAX_MESSAGE_BYTES = 4096;
/** JSON can expand each text byte into a six-byte escape, plus bounded metadata. */
export const MAX_DATA_BODY_BYTES = 6 * MAX_MESSAGE_BYTES + 512;
export const MAX_DATA_CIPHERTEXT_BYTES = MAX_DATA_BODY_BYTES + 16;
/** Complete UTF-8 wire frame cap, including base64url and the three-field header. */
export const MAX_DATA_ENVELOPE_BYTES =
	Math.ceil((MAX_DATA_CIPHERTEXT_BYTES * 4) / 3) + 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SEQUENCE = /^(0|[1-9][0-9]{0,19})$/;
const SESSION_ID = /^[0-9a-f]{32}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PADDING = /[=]+$/;
// Exactly 16 bytes, canonically encoded without padding (including final pad bits).
const ROOM_ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const claimedHandshakes = new WeakSet<EphemeralHandshake>();
const CONSTRUCTION_TOKEN = Symbol("data-envelope-session");

export type DataEnvelopeFailure =
	| "invalid_input"
	| "invalid_envelope"
	| "invalid_body"
	| "session_mismatch"
	| "authentication_failed"
	| "replay_rejected"
	| "counter_exhausted"
	| "encryption_failed"
	| "disposed";
export type DataEnvelopeResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: DataEnvelopeFailure };

function failure(error: DataEnvelopeFailure): DataEnvelopeResult<never> {
	return { error, ok: false };
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(PADDING, "");
}

function unbase64url(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(
		atob(value.replaceAll("-", "+").replaceAll("_", "/")),
		(character) => character.charCodeAt(0)
	);
}

const ciphertextSchema = z
	.string()
	.min(22)
	.max(Math.ceil((MAX_DATA_CIPHERTEXT_BYTES * 4) / 3))
	.regex(BASE64URL)
	.refine((value) => {
		try {
			if (value.length > Math.ceil((MAX_DATA_CIPHERTEXT_BYTES * 4) / 3)) {
				return false;
			}
			const bytes = unbase64url(value);
			return (
				bytes.byteLength >= 16 &&
				bytes.byteLength <= MAX_DATA_CIPHERTEXT_BYTES &&
				base64url(bytes) === value
			);
		} catch {
			return false;
		}
	});

/** No body type, role, message ID, confirmation, or end control is visible. */
export const dataEnvelopeSchema = z.strictObject({
	ciphertext: ciphertextSchema,
	sequence: z
		.string()
		.regex(SEQUENCE)
		.refine(
			(value) => SEQUENCE.test(value) && BigInt(value) <= MAX_DATA_SEQUENCE
		),
	sessionId: z.string().regex(SESSION_ID),
});
export type DataEnvelope = z.infer<typeof dataEnvelopeSchema>;

const messageId = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_-]+$/);
export const dataBodySchema = z.discriminatedUnion("type", [
	z.strictObject({
		id: messageId,
		text: z
			.string()
			.min(1)
			.max(MAX_MESSAGE_BYTES)
			.refine((text) => encoder.encode(text).byteLength <= MAX_MESSAGE_BYTES),
		type: z.literal("message"),
	}),
	z.strictObject({ messageId, type: z.literal("acknowledgement") }),
	z.strictObject({ confirmed: z.boolean(), type: z.literal("verification") }),
	z.strictObject({ type: z.literal("end") }),
]);
export type DataBody = z.infer<typeof dataBodySchema>;

function decodeDataBody(plaintext: Uint8Array): DataEnvelopeResult<DataBody> {
	try {
		if (plaintext.byteLength > MAX_DATA_BODY_BYTES) {
			return failure("invalid_body");
		}
		const parsed = dataBodySchema.safeParse(
			JSON.parse(decoder.decode(plaintext))
		);
		return parsed.success
			? { ok: true, value: parsed.data }
			: failure("invalid_body");
	} catch {
		return failure("invalid_body");
	}
}

/** Bound bytes before JSON parsing; validation errors/payloads never escape. */
export function decodeDataEnvelope(
	input: unknown
): DataEnvelopeResult<DataEnvelope> {
	try {
		let value = input;
		if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
			if (input.byteLength > MAX_DATA_ENVELOPE_BYTES) {
				return failure("invalid_envelope");
			}
			value = decoder.decode(input);
		}
		if (typeof value === "string") {
			if (
				value.length > MAX_DATA_ENVELOPE_BYTES ||
				encoder.encode(value).byteLength > MAX_DATA_ENVELOPE_BYTES
			) {
				return failure("invalid_envelope");
			}
			value = JSON.parse(value);
		}
		const parsed = dataEnvelopeSchema.safeParse(value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: failure("invalid_envelope");
	} catch {
		return failure("invalid_envelope");
	}
}

export function encodeDataEnvelope(input: unknown): DataEnvelopeResult<string> {
	const parsed = decodeDataEnvelope(input);
	return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value) } : parsed;
}

/** 96-bit IV: zero32 || uint64(sequence), network/big-endian byte order. */
export function dataEnvelopeIv(sequence: bigint): Uint8Array<ArrayBuffer> {
	if (sequence < BigInt(0) || sequence > MAX_DATA_SEQUENCE) {
		throw new RangeError("Invalid data sequence");
	}
	const iv = new Uint8Array(12);
	new DataView(iv.buffer).setBigUint64(4, sequence, false);
	return iv;
}

function opposite(role: ParticipantRole): ParticipantRole {
	return role === "creator" ? "joiner" : "creator";
}

function aad(sessionId: string, role: ParticipantRole, sequence: string) {
	const peer = opposite(role);
	return encoder.encode(
		JSON.stringify([
			"glassroom/data",
			1,
			sessionId,
			`${role}-to-${peer}`,
			sequence,
		])
	);
}

export interface DataEnvelopeOptions {
	/** Conservative exhaustion seam, never a seed or restore counter. */
	counterLimit?: bigint;
}

/**
 * One instance per mutually authenticated handshake. Human fingerprint gating is
 * the caller's responsibility. No key import, counter restore, or resumption API.
 */
export class DataEnvelopeSession {
	readonly #sessionId: string;
	readonly #role: ParticipantRole;
	readonly #counterLimit: bigint;
	#handshake: EphemeralHandshake | undefined;
	#keys: SessionKeys | undefined;
	#outgoing = BigInt(0);
	#acceptedIncoming: bigint | null = null;
	#disposed = false;
	#sends: Promise<void> = Promise.resolve();
	#receives: Promise<void> = Promise.resolve();

	private constructor(
		handshake: EphemeralHandshake,
		counterLimit: bigint,
		token: symbol
	) {
		// TypeScript's private constructor alone does not protect JS callers.
		if (token !== CONSTRUCTION_TOKEN) {
			throw new Error("Invalid data session construction");
		}
		this.#sessionId = handshake.getSessionMetadata().sessionId;
		this.#role = handshake.getHello().role;
		this.#keys = handshake.getSessionKeys();
		this.#handshake = handshake;
		this.#counterLimit = counterLimit;
	}

	static create(
		handshake: EphemeralHandshake,
		options: DataEnvelopeOptions = {}
	): DataEnvelopeResult<DataEnvelopeSession> {
		try {
			const counterLimit = options.counterLimit ?? MAX_DATA_SEQUENCE;
			if (
				!(handshake instanceof EphemeralHandshake) ||
				handshake.state !== "authenticated" ||
				claimedHandshakes.has(handshake) ||
				!ROOM_ID.test(handshake.getHello().roomId) ||
				typeof counterLimit !== "bigint" ||
				counterLimit < BigInt(0) ||
				counterLimit > MAX_DATA_SEQUENCE
			) {
				return failure("invalid_input");
			}
			const session = new DataEnvelopeSession(
				handshake,
				counterLimit,
				CONSTRUCTION_TOKEN
			);
			claimedHandshakes.add(handshake);
			return { ok: true, value: session };
		} catch {
			return failure("invalid_input");
		}
	}

	get disposed(): boolean {
		return this.#disposed;
	}

	/** Drops owned references, including handshake keys; cannot cancel engine copies. */
	dispose(): void {
		this.#disposed = true;
		this.#keys = undefined;
		this.#acceptedIncoming = null;
		this.#handshake?.destroy();
		this.#handshake = undefined;
	}

	encrypt(input: unknown): Promise<DataEnvelopeResult<DataEnvelope>> {
		// Validate/snapshot now, before queued work can observe caller mutation.
		let bytes: Uint8Array<ArrayBuffer> | undefined;
		try {
			const parsed = dataBodySchema.safeParse(input);
			if (parsed.success) {
				bytes = encoder.encode(JSON.stringify(parsed.data));
			}
		} catch {
			// Return a static failure below, never a schema/engine error or body.
		}
		const snapshot = bytes;
		const run = async (): Promise<DataEnvelopeResult<DataEnvelope>> => {
			if (this.disposed || !this.#keys) {
				return failure("disposed");
			}
			if (!snapshot || snapshot.byteLength > MAX_DATA_BODY_BYTES) {
				return failure("invalid_body");
			}
			if (this.#outgoing > this.#counterLimit) {
				this.dispose();
				return failure("counter_exhausted");
			}
			const sequence = this.#outgoing;
			// Reserve before any await; a failed encryption can never reuse its IV.
			this.#outgoing += BigInt(1);
			try {
				const encrypted = await crypto.subtle.encrypt(
					{
						additionalData: aad(
							this.#sessionId,
							this.#role,
							sequence.toString()
						),
						iv: dataEnvelopeIv(sequence),
						name: "AES-GCM",
						tagLength: 128,
					},
					this.#keys.send,
					snapshot
				);
				if (this.disposed) {
					return failure("disposed");
				}
				return {
					ok: true,
					value: {
						ciphertext: base64url(new Uint8Array(encrypted)),
						sequence: sequence.toString(),
						sessionId: this.#sessionId,
					},
				};
			} catch {
				this.dispose();
				return failure("encryption_failed");
			}
		};
		const result = this.#sends.then(run).finally(() => snapshot?.fill(0));
		// Settled queue promises retain no body/ciphertext/result.
		this.#sends = result.then(() => undefined);
		return result;
	}

	decrypt(input: unknown): Promise<DataEnvelopeResult<DataBody>> {
		const parsed = decodeDataEnvelope(input);
		const run = async (): Promise<DataEnvelopeResult<DataBody>> => {
			if (this.disposed || !this.#keys) {
				return failure("disposed");
			}
			if (!parsed.ok) {
				return parsed;
			}
			const envelope = parsed.value;
			if (envelope.sessionId !== this.#sessionId) {
				return failure("session_mismatch");
			}
			const sequence = BigInt(envelope.sequence);
			if (
				this.#acceptedIncoming !== null &&
				sequence <= this.#acceptedIncoming
			) {
				return failure("replay_rejected");
			}
			if (sequence > this.#counterLimit) {
				return failure("counter_exhausted");
			}
			let plaintext: Uint8Array | undefined;
			try {
				const peerRole = opposite(this.#role);
				plaintext = new Uint8Array(
					await crypto.subtle.decrypt(
						{
							additionalData: aad(this.#sessionId, peerRole, envelope.sequence),
							iv: dataEnvelopeIv(sequence),
							name: "AES-GCM",
							tagLength: 128,
						},
						this.#keys.receive,
						unbase64url(envelope.ciphertext)
					)
				);
			} catch {
				return failure("authentication_failed");
			}
			try {
				if (this.disposed) {
					return failure("disposed");
				}
				const body = decodeDataBody(plaintext);
				if (!body.ok) {
					return body;
				}
				// Advance only after authentication AND body validation, in receive order.
				this.#acceptedIncoming = sequence;
				return body;
			} finally {
				plaintext.fill(0);
			}
		};
		const result = this.#receives.then(run);
		this.#receives = result.then(() => undefined);
		return result;
	}
}
