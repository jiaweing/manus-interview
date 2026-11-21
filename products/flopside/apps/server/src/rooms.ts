import { randomBytes, randomInt } from "node:crypto";
import { startMatch as dealMatch } from "@flopside/engine/dealing";
import type { DeckSource } from "@flopside/engine/shuffle";
import type { MatchState } from "@flopside/engine/state";
import { z } from "zod";

export const ROOM_IDLE_MS = 30 * 60 * 1000;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const nicknameSchema = z.string().trim().min(1).max(16);

export type RoomErrorCode =
	| "ROOM_FULL"
	| "MATCH_STARTED"
	| "ROOM_EXPIRED"
	| "AUTH_REQUIRED"
	| "ILLEGAL_ACTION";

export class RoomError extends Error {
	readonly code: RoomErrorCode;

	constructor(code: RoomErrorCode) {
		super(code);
		this.name = "RoomError";
		this.code = code;
	}
}

export function parseNickname(value: unknown): string {
	const result = nicknameSchema.safeParse(value);
	if (!result.success) {
		throw new RoomError("ILLEGAL_ACTION");
	}
	return result.data;
}

export interface LobbySeat {
	connected: boolean;
	id: string;
	index: number;
	nickname: string;
}

export interface LobbyState {
	code: string;
	hostSeatId: string;
	phase: "lobby" | "playing";
	revision: number;
	seats: LobbySeat[];
	viewerSeatId: string;
}

export interface SeatAdmission {
	seat: LobbySeat & { token: string };
	state: LobbyState;
}

interface StoredSeat extends LobbySeat {
	token: string;
}

interface StoredRoom {
	code: string;
	hostSeatId: string;
	lastActivityAt: number;
	match: MatchState | null;
	phase: "lobby" | "playing";
	revision: number;
	seats: StoredSeat[];
}

interface RoomStoreOptions {
	codeGenerator?: () => string;
	/** Test-only function injection. Production never supplies a deck source. */
	deckSource?: DeckSource;
	now?: () => number;
}

function generateCode(): string {
	return Array.from({ length: 6 }, () =>
		ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length))
	).join("");
}

function publicSeat(seat: StoredSeat): LobbySeat {
	return {
		connected: seat.connected,
		id: seat.id,
		index: seat.index,
		nickname: seat.nickname,
	};
}

/** Synchronous mutation boundary: #38 can queue calls per room without awaits. */
export class RoomStore {
	readonly #rooms = new Map<string, StoredRoom>();
	readonly #now: () => number;
	readonly #codeGenerator: () => string;
	readonly #deckSource: DeckSource | undefined;

	constructor({
		now = Date.now,
		codeGenerator = generateCode,
		deckSource,
	}: RoomStoreOptions = {}) {
		this.#now = now;
		this.#codeGenerator = codeGenerator;
		this.#deckSource = deckSource;
	}

	create(nickname: unknown): SeatAdmission {
		const name = parseNickname(nickname);
		const now = this.#now();
		for (const [code, room] of this.#rooms) {
			if (now - room.lastActivityAt >= ROOM_IDLE_MS) {
				this.#rooms.delete(code);
			}
		}
		let code: string;
		do {
			code = this.#codeGenerator();
			if (
				code.length !== 6 ||
				[...code].some((letter) => !ROOM_CODE_ALPHABET.includes(letter))
			) {
				throw new Error(
					"Room code generator must return six unambiguous characters"
				);
			}
		} while (this.#rooms.has(code));
		const seat = this.#newSeat(name, 0);
		const room: StoredRoom = {
			code,
			hostSeatId: seat.id,
			lastActivityAt: now,
			match: null,
			phase: "lobby",
			revision: 1,
			seats: [seat],
		};
		this.#rooms.set(code, room);
		return this.#admission(room, seat);
	}

	join(code: string, nickname: unknown): SeatAdmission {
		const room = this.#activeRoom(code);
		const name = parseNickname(nickname);
		if (room.phase !== "lobby") {
			throw new RoomError("MATCH_STARTED");
		}
		if (room.seats.length >= 4) {
			throw new RoomError("ROOM_FULL");
		}
		const seat = this.#newSeat(name, room.seats.length);
		room.seats.push(seat);
		room.revision += 1;
		return this.#admission(room, seat);
	}

	/** Requests (including rejected commands) refresh a live room, never revive it. */
	touch(code: string): void {
		this.#activeRoom(code);
	}

	getLobby(code: string, seatId: string): LobbyState {
		const room = this.#activeRoom(code);
		this.#seat(room, seatId);
		return this.#lobby(room, seatId);
	}

	markConnected(code: string, seatId: string): LobbyState {
		return this.#setConnected(code, seatId, true);
	}

	markDisconnected(code: string, seatId: string): LobbyState {
		return this.#setConnected(code, seatId, false);
	}

	startMatch(code: string, seatId: string): LobbyState {
		const room = this.#activeRoom(code);
		this.#seat(room, seatId);
		if (room.phase !== "lobby") {
			throw new RoomError("MATCH_STARTED");
		}
		const connected = room.seats.filter((seat) => seat.connected);
		if (
			room.hostSeatId !== seatId ||
			connected.length < 2 ||
			connected.length > 4
		) {
			throw new RoomError("ILLEGAL_ACTION");
		}
		// Only connected players enter the engine; the room roster stays reserved/locked.
		// Compute before mutating so a failing test deck cannot partly start a room.
		const match = dealMatch(
			connected.map((seat) => ({ id: seat.id })),
			this.#deckSource
		);
		room.match = match;
		room.phase = "playing";
		room.revision += 1;
		return this.#lobby(room, seatId);
	}

	/** SERVER ONLY: #37 projects this private clone. Never serialize or log it. */
	getMatchState(code: string): MatchState | null {
		const room = this.#activeRoom(code);
		return room.match ? structuredClone(room.match) : null;
	}

	#activeRoom(code: string): StoredRoom {
		const room = this.#rooms.get(code);
		const now = this.#now();
		if (!room || now - room.lastActivityAt >= ROOM_IDLE_MS) {
			this.#rooms.delete(code);
			throw new RoomError("ROOM_EXPIRED");
		}
		room.lastActivityAt = now;
		return room;
	}

	#newSeat(nickname: string, index: number): StoredSeat {
		return {
			connected: false,
			id: `seat-${index}`,
			index,
			nickname,
			token: randomBytes(32).toString("hex"),
		};
	}

	#seat(room: StoredRoom, seatId: string): StoredSeat {
		const seat = room.seats.find((candidate) => candidate.id === seatId);
		if (!seat) {
			throw new RoomError("AUTH_REQUIRED");
		}
		return seat;
	}

	#setConnected(code: string, seatId: string, connected: boolean): LobbyState {
		const room = this.#activeRoom(code);
		const seat = this.#seat(room, seatId);
		if (seat.connected !== connected) {
			seat.connected = connected;
			if (
				room.phase === "lobby" &&
				!this.#seat(room, room.hostSeatId).connected
			) {
				room.hostSeatId =
					room.seats.find((candidate) => candidate.connected)?.id ??
					room.hostSeatId;
			}
			room.revision += 1;
		}
		return this.#lobby(room, seatId);
	}

	#lobby(room: StoredRoom, seatId: string): LobbyState {
		return {
			code: room.code,
			hostSeatId: room.hostSeatId,
			phase: room.phase,
			revision: room.revision,
			seats: room.seats.map(publicSeat),
			viewerSeatId: seatId,
		};
	}

	#admission(room: StoredRoom, seat: StoredSeat): SeatAdmission {
		return {
			seat: { ...publicSeat(seat), token: seat.token },
			state: this.#lobby(room, seat.id),
		};
	}
}
