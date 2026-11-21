import type { SignalingRole } from "./crypto/signaling";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PADDING = /[=]+$/;
const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{22})$/;
const SECRET_FRAGMENT = /^#s=([A-Za-z0-9_-]{43})$/;

export interface Invitation {
	roomId: string;
	secret: Uint8Array<ArrayBuffer>;
}

export type InvitationResult =
	| { ok: true; invitation: Invitation }
	| { ok: false; error: "missing" | "invalid" };

function encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(PADDING, "");
}

function decode(value: string, length: number): Uint8Array<ArrayBuffer> | null {
	if (!BASE64URL.test(value)) {
		return null;
	}
	try {
		const bytes = Uint8Array.from(
			atob(value.replaceAll("-", "+").replaceAll("_", "/")),
			(character) => character.charCodeAt(0)
		);
		return bytes.byteLength === length && encode(bytes) === value
			? bytes
			: null;
	} catch {
		return null;
	}
}

/** Invoke only in the browser, in response to creating a fresh room. */
export function createInvitation(): Invitation {
	return {
		roomId: encode(crypto.getRandomValues(new Uint8Array(16))),
		secret: crypto.getRandomValues(new Uint8Array(32)),
	};
}

/** Strictly accept /r/{canonical 16 bytes}#s={canonical 32 bytes}. */
export function parseInvitation(
	pathname: string,
	hash: string
): InvitationResult {
	const room = ROOM_PATH.exec(pathname)?.[1];
	if (!(room && decode(room, 16))) {
		return { error: "invalid", ok: false };
	}
	if (!hash || hash === "#s=") {
		return { error: "missing", ok: false };
	}
	const encodedSecret = SECRET_FRAGMENT.exec(hash)?.[1];
	const secret = encodedSecret ? decode(encodedSecret, 32) : null;
	return secret
		? { invitation: { roomId: room, secret }, ok: true }
		: { error: "invalid", ok: false };
}

/** Build the secret-bearing URL only for the deliberate clipboard action. */
export function invitationUrl(invitation: Invitation, origin: string): string {
	return `${origin}/r/${invitation.roomId}#s=${encode(invitation.secret)}`;
}

/** The sole admission envelope: never includes the invitation secret. */
export function admissionEnvelope(roomId: string, role: SignalingRole): string {
	return JSON.stringify({ operation: "join", role, roomId, version: 1 });
}
