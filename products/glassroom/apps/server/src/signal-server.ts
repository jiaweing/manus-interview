import { z } from "zod";

/** Cap the complete UTF-8 JSON frame, including metadata and base64url overhead. */
export const SIGNAL_FRAME_CAP_BYTES = 128 * 1024;
/** 64 KiB encrypted signaling plus the 16-byte AES-GCM authentication tag. */
export const SIGNAL_CIPHERTEXT_CAP_BYTES = 64 * 1024 + 16;
export const SIGNAL_VERSION = 1;
const MAX_COUNTER = 2n ** 64n - 1n;
const COUNTER = /^(0|[1-9][0-9]{0,19})$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;

function canonicalBase64url(
	value: string,
	minimum: number,
	maximum: number
): boolean {
	const bytes = Buffer.from(value, "base64url");
	return (
		bytes.byteLength >= minimum &&
		bytes.byteLength <= maximum &&
		bytes.toString("base64url") === value
	);
}

const common = {
	role: z.enum(["creator", "joiner"]),
	roomId: z
		.string()
		.regex(ROOM_ID)
		.refine((value) => canonicalBase64url(value, 16, 16)),
	version: z.literal(SIGNAL_VERSION),
};

export const joinEnvelopeSchema = z.strictObject({
	...common,
	operation: z.literal("join"),
});

export const encryptedForwardEnvelopeSchema = z.strictObject({
	...common,
	ciphertext: z
		.string()
		.min(22)
		.max(4 * Math.ceil(SIGNAL_CIPHERTEXT_CAP_BYTES / 3))
		.regex(BASE64URL)
		.refine((value) =>
			canonicalBase64url(value, 16, SIGNAL_CIPHERTEXT_CAP_BYTES)
		),
	counter: z
		.string()
		.regex(COUNTER)
		.refine((value) => COUNTER.test(value) && BigInt(value) <= MAX_COUNTER),
	operation: z.literal("forward"),
});

export const signalEnvelopeSchema = z.union([
	joinEnvelopeSchema,
	encryptedForwardEnvelopeSchema,
]);
export type SignalEnvelope = z.infer<typeof signalEnvelopeSchema>;

export interface SignalSocket {
	close: (code?: number, reason?: string) => void;
	send: (frame: string) => unknown;
}

type Membership = Pick<SignalEnvelope, "roomId" | "role">;
type Room = { creator: SignalSocket; joiner?: SignalSocket };

/** No keys, plaintext, history, database, timers, or reconnection state. */
export class SignalServer {
	private readonly roomMap = new Map<string, Room>();
	private readonly memberships = new Map<SignalSocket, Membership>();
	private readonly openSockets = new Set<SignalSocket>();

	get rooms(): ReadonlyMap<string, Readonly<Room>> {
		return this.roomMap;
	}

	open(socket: SignalSocket): void {
		this.openSockets.add(socket);
		socket.send(JSON.stringify({ type: "ready" }));
	}

	message(socket: SignalSocket, raw: string | Uint8Array | ArrayBuffer): void {
		if (!this.openSockets.has(socket)) {
			return;
		}
		const byteLength =
			typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
		if (byteLength > SIGNAL_FRAME_CAP_BYTES) {
			this.reject(socket, 1009, "frame-too-large");
			return;
		}
		if (typeof raw !== "string") {
			this.reject(socket);
			return;
		}
		let decoded: unknown;
		try {
			decoded = JSON.parse(raw);
		} catch {
			this.reject(socket);
			return;
		}
		const parsed = signalEnvelopeSchema.safeParse(decoded);
		if (!parsed.success) {
			this.reject(socket);
			return;
		}
		const envelope = parsed.data;
		if (envelope.operation === "join") {
			this.admit(socket, envelope);
			return;
		}
		const membership = this.memberships.get(socket);
		if (
			!membership ||
			membership.roomId !== envelope.roomId ||
			membership.role !== envelope.role
		) {
			this.reject(socket);
			return;
		}
		const room = this.roomMap.get(membership.roomId);
		const peer = membership.role === "creator" ? room?.joiner : room?.creator;
		if (!peer) {
			// There is no queue or signaling fallback when the other participant is absent.
			this.reject(socket);
			return;
		}
		peer.send(raw);
	}

	close(socket: SignalSocket): void {
		this.openSockets.delete(socket);
		const membership = this.memberships.get(socket);
		this.memberships.delete(socket);
		if (!membership) {
			return;
		}
		const room = this.roomMap.get(membership.roomId);
		// Delete before peer callbacks; a late close cannot remove a new room with the same ID.
		this.roomMap.delete(membership.roomId);
		const peer = membership.role === "creator" ? room?.joiner : room?.creator;
		if (peer) {
			this.memberships.delete(peer);
			this.openSockets.delete(peer);
			peer.send(JSON.stringify({ type: "terminated" }));
			peer.close(1000, "room-ended");
		}
	}

	private admit(
		socket: SignalSocket,
		envelope: z.infer<typeof joinEnvelopeSchema>
	): void {
		if (this.memberships.has(socket)) {
			this.reject(socket);
			return;
		}
		const existing = this.roomMap.get(envelope.roomId);
		if (envelope.role === "creator") {
			if (existing) {
				this.reject(socket);
				return;
			}
			this.roomMap.set(envelope.roomId, { creator: socket });
		} else {
			if (!existing || existing.joiner) {
				this.reject(socket);
				return;
			}
			existing.joiner = socket;
		}
		this.memberships.set(socket, {
			role: envelope.role,
			roomId: envelope.roomId,
		});
		socket.send(
			JSON.stringify({
				role: envelope.role,
				roomId: envelope.roomId,
				type: "joined",
				version: SIGNAL_VERSION,
			})
		);
		if (envelope.role === "joiner") {
			existing?.creator.send(JSON.stringify({ type: "peer-joined" }));
		}
	}

	private reject(
		socket: SignalSocket,
		code = 1008,
		reason = "invalid-signal"
	): void {
		this.close(socket);
		socket.close(code, reason);
	}
}
