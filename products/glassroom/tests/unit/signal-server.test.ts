import { describe, expect, mock, test } from "bun:test";
import {
	SIGNAL_CIPHERTEXT_CAP_BYTES,
	SIGNAL_FRAME_CAP_BYTES,
	SignalServer,
	type SignalSocket,
} from "../../apps/server/src/signal-server";

const ROOM = Buffer.alloc(16, 0xa1).toString("base64url");
const OTHER_ROOM = Buffer.alloc(16, 0xb2).toString("base64url");
const CIPHERTEXT = Buffer.from(
	Array.from({ length: 32 }, (_, i) => i)
).toString("base64url");

class Socket implements SignalSocket {
	readonly forwarded: string[] = [];
	readonly controls: unknown[] = [];
	readonly send = mock((raw: string) => {
		const frame = JSON.parse(raw);
		if (frame.operation === "forward") {
			this.forwarded.push(raw);
		} else {
			this.controls.push(frame);
		}
		return raw.length;
	});
	readonly close = mock((_code?: number, _reason?: string) => {
		// Record close calls without triggering transport callbacks in this unit fake.
	});
}

function join(role: "creator" | "joiner", roomId = ROOM): string {
	return JSON.stringify({ operation: "join", role, roomId, version: 1 });
}

function forward(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		ciphertext: CIPHERTEXT,
		counter: "0",
		operation: "forward",
		role: "creator",
		roomId: ROOM,
		version: 1,
		...overrides,
	});
}

function connect(server: SignalServer): Socket {
	const socket = new Socket();
	server.open(socket);
	expect(socket.controls).toEqual([{ type: "ready" }]);
	return socket;
}

function pair(): { server: SignalServer; creator: Socket; joiner: Socket } {
	const server = new SignalServer();
	const creator = connect(server);
	const joiner = connect(server);
	server.message(creator, join("creator"));
	server.message(joiner, join("joiner"));
	return { creator, joiner, server };
}

function noPeerForwards(...sockets: Socket[]): void {
	for (const socket of sockets) {
		expect(socket.forwarded).toHaveLength(0);
	}
}

function assertPairIntact(
	server: SignalServer,
	creator: Socket,
	joiner: Socket
): void {
	expect(server.rooms.get(ROOM)).toEqual({ creator, joiner });
	expect(creator.close).not.toHaveBeenCalled();
	expect(joiner.close).not.toHaveBeenCalled();
}

describe("memory-only signal server", () => {
	test("creator plus one joiner", () => {
		const { server, creator, joiner } = pair();
		expect(server.rooms.size).toBe(1);
		assertPairIntact(server, creator, joiner);
		expect(creator.controls).toEqual([
			{ type: "ready" },
			{ role: "creator", roomId: ROOM, type: "joined", version: 1 },
			{ type: "peer-joined" },
		]);
		expect(joiner.controls).toEqual([
			{ type: "ready" },
			{ role: "joiner", roomId: ROOM, type: "joined", version: 1 },
		]);
		noPeerForwards(creator, joiner);
	});

	test("third participant rejected", () => {
		const { server, creator, joiner } = pair();
		for (const role of ["creator", "joiner"] as const) {
			const third = connect(server);
			server.message(third, join(role));
			expect(third.close).toHaveBeenCalledWith(1008, "invalid-signal");
			noPeerForwards(creator, joiner, third);
			assertPairIntact(server, creator, joiner);
			// Late close and extra frames cannot evict or impersonate an admitted peer.
			server.close(third);
			server.message(third, forward());
			noPeerForwards(creator, joiner, third);
			assertPairIntact(server, creator, joiner);
		}
		server.message(creator, forward());
		expect(joiner.forwarded).toEqual([forward()]);
	});

	test("duplicate role rejected", () => {
		const server = new SignalServer();
		const creator = connect(server);
		server.message(creator, join("creator"));
		const duplicate = connect(server);
		server.message(duplicate, join("creator"));
		expect(duplicate.close).toHaveBeenCalledWith(1008, "invalid-signal");
		expect(server.rooms.get(ROOM)).toEqual({ creator });
		expect(creator.close).not.toHaveBeenCalled();
		noPeerForwards(creator, duplicate);
		const joiner = connect(server);
		server.message(joiner, join("joiner"));
		const duplicateJoiner = connect(server);
		server.message(duplicateJoiner, join("joiner"));
		expect(duplicateJoiner.close).toHaveBeenCalledWith(1008, "invalid-signal");
		noPeerForwards(creator, joiner, duplicate, duplicateJoiner);
		assertPairIntact(server, creator, joiner);
	});

	test("join nonexistent room rejected", () => {
		const server = new SignalServer();
		const joiner = connect(server);
		server.message(joiner, join("joiner"));
		expect(joiner.close).toHaveBeenCalledWith(1008, "invalid-signal");
		expect(server.rooms.has(ROOM)).toBe(false);
		noPeerForwards(joiner);
		server.close(joiner);
		expect(server.rooms.size).toBe(0);
	});

	test("socket room-role binding", () => {
		for (const override of [{ roomId: OTHER_ROOM }, { role: "joiner" }]) {
			const { server, creator, joiner } = pair();
			const unrelatedCreator = connect(server);
			const unrelatedJoiner = connect(server);
			server.message(unrelatedCreator, join("creator", OTHER_ROOM));
			server.message(unrelatedJoiner, join("joiner", OTHER_ROOM));
			server.message(creator, forward(override));
			expect(creator.close).toHaveBeenCalledWith(1008, "invalid-signal");
			noPeerForwards(creator, joiner, unrelatedCreator, unrelatedJoiner);
			expect(server.rooms.has(ROOM)).toBe(false);
			expect(server.rooms.has(OTHER_ROOM)).toBe(true);
			expect(unrelatedCreator.close).not.toHaveBeenCalled();
			expect(unrelatedJoiner.close).not.toHaveBeenCalled();
		}
		const { server, creator, joiner } = pair();
		const outsider = connect(server);
		server.message(outsider, forward());
		expect(outsider.close).toHaveBeenCalledWith(1008, "invalid-signal");
		noPeerForwards(creator, joiner, outsider);
		assertPairIntact(server, creator, joiner);
		server.message(creator, join("creator", OTHER_ROOM));
		expect(creator.close).toHaveBeenCalledWith(1008, "invalid-signal");
		noPeerForwards(creator, joiner, outsider);
		expect(server.rooms.size).toBe(0);
	});

	test("schema and over-cap rejection", () => {
		const invalid: (string | Uint8Array | ArrayBuffer)[] = [
			"not-json",
			"null",
			"[]",
			"{}",
			forward({ version: 2 }),
			forward({ version: "1" }),
			forward({ roomId: "not-a-room" }),
			forward({ roomId: `${"A".repeat(21)}B` }),
			forward({ roomId: "a1".repeat(16) }),
			forward({ roomId: undefined }),
			forward({ role: "guest" }),
			forward({ role: undefined }),
			forward({ operation: "message" }),
			forward({ message: "forbidden-plaintext-body" }),
			forward({ secret: "forbidden" }),
			forward({ length: 32 }), // Length is derived from canonical ciphertext, never trusted metadata.
			forward({ ciphertext: "not+base64/url=" }),
			forward({ ciphertext: "A" }),
			forward({ ciphertext: `${CIPHERTEXT}=` }),
			forward({ ciphertext: undefined }),
			forward({ ciphertext: `${"A".repeat(21)}B` }),
			forward({ ciphertext: Buffer.alloc(15).toString("base64url") }),
			forward({
				ciphertext: Buffer.alloc(SIGNAL_CIPHERTEXT_CAP_BYTES + 1).toString(
					"base64url"
				),
			}),
			forward({ counter: "-1" }),
			forward({ counter: "00" }),
			forward({ counter: 0 }),
			forward({ counter: "18446744073709551616" }),
			forward({ counter: undefined }),
			forward({ counter: "99999999999999999999999999999999999" }),
			JSON.stringify({
				ciphertext: CIPHERTEXT,
				operation: "join",
				role: "creator",
				roomId: ROOM,
				version: 1,
			}),
			JSON.stringify({
				operation: "join",
				role: "creator",
				roomId: ROOM,
				version: 2,
			}),
			new Uint8Array([1, 2, 3]),
			new ArrayBuffer(0),
			" ".repeat(SIGNAL_FRAME_CAP_BYTES + 1),
			forward({ extra: "é".repeat(SIGNAL_FRAME_CAP_BYTES / 2) }),
			new Uint8Array(SIGNAL_FRAME_CAP_BYTES + 1),
		];
		for (const raw of invalid) {
			const { server, creator, joiner } = pair();
			server.message(creator, raw);
			const size =
				typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength;
			expect(creator.close).toHaveBeenCalledWith(
				size > SIGNAL_FRAME_CAP_BYTES ? 1009 : 1008,
				size > SIGNAL_FRAME_CAP_BYTES ? "frame-too-large" : "invalid-signal"
			);
			noPeerForwards(creator, joiner);
			expect(server.rooms.has(ROOM)).toBe(false);
			expect(joiner.close).toHaveBeenCalledWith(1000, "room-ended");
		}
	});

	test("ciphertext forwarded unchanged", () => {
		const { server, creator, joiner } = pair();
		const raw = ` \n${forward()}\t `;
		server.message(creator, raw);
		expect(joiner.forwarded).toEqual([raw]);
		expect(creator.forwarded).toEqual([]);
		const reply = forward({ counter: "18446744073709551615", role: "joiner" });
		server.message(joiner, reply);
		expect(creator.forwarded).toEqual([reply]);
		assertPairIntact(server, creator, joiner);
	});

	test("termination deletes room", () => {
		for (const role of ["creator", "joiner"] as const) {
			const { server, creator, joiner } = pair();
			const leaving = role === "creator" ? creator : joiner;
			const remaining = role === "creator" ? joiner : creator;
			server.close(leaving);
			expect(server.rooms.has(ROOM)).toBe(false);
			expect(server.rooms.size).toBe(0);
			expect(remaining.controls.at(-1)).toEqual({ type: "terminated" });
			expect(remaining.close).toHaveBeenCalledWith(1000, "room-ended");
			server.message(
				remaining,
				forward({ role: role === "creator" ? "joiner" : "creator" })
			);
			noPeerForwards(creator, joiner);
			const replacement = connect(server);
			server.message(replacement, join("creator"));
			server.close(leaving);
			server.close(remaining);
			expect(server.rooms.get(ROOM)).toEqual({ creator: replacement });
			expect(replacement.close).not.toHaveBeenCalled();
			server.close(replacement);
			expect(server.rooms.has(ROOM)).toBe(false);
		}
		const server = new SignalServer();
		const loneCreator = connect(server);
		server.message(loneCreator, join("creator"));
		server.close(loneCreator);
		expect(server.rooms.has(ROOM)).toBe(false);
	});

	test("complete UTF-8 frame cap is inclusive", () => {
		const { server, creator, joiner } = pair();
		const raw = forward();
		const atCap =
			raw + " ".repeat(SIGNAL_FRAME_CAP_BYTES - Buffer.byteLength(raw));
		expect(Buffer.byteLength(atCap)).toBe(SIGNAL_FRAME_CAP_BYTES);
		server.message(creator, atCap);
		expect(joiner.forwarded).toEqual([atCap]);
		assertPairIntact(server, creator, joiner);
	});

	test("decoded ciphertext cap is inclusive", () => {
		const { server, creator, joiner } = pair();
		const raw = forward({
			ciphertext: Buffer.alloc(SIGNAL_CIPHERTEXT_CAP_BYTES).toString(
				"base64url"
			),
		});
		expect(Buffer.byteLength(raw)).toBeLessThan(SIGNAL_FRAME_CAP_BYTES);
		server.message(creator, raw);
		expect(joiner.forwarded).toEqual([raw]);
		assertPairIntact(server, creator, joiner);
	});

	test("no forwarding queue before a peer joins", () => {
		const server = new SignalServer();
		const creator = connect(server);
		server.message(creator, join("creator"));
		server.message(creator, forward());
		expect(creator.close).toHaveBeenCalledWith(1008, "invalid-signal");
		noPeerForwards(creator);
		expect(server.rooms.has(ROOM)).toBe(false);
	});
});
