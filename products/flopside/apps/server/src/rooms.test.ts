import { describe, expect, test } from "bun:test";
import { fullDeck } from "@flopside/engine/cards";
import { createApp } from "./app";
import {
	ROOM_CODE_ALPHABET,
	ROOM_IDLE_MS,
	RoomError,
	type RoomErrorCode,
	RoomStore,
	type SeatAdmission,
} from "./rooms";

const tokenPattern = /^[0-9a-f]{64}$/;
const productionStorePattern = /roomStore\s*=\s*new RoomStore\(\)/;
const environmentPattern = /(?:process|Bun)\.env/;
const privateKeys = new Set(["deck", "holeCards", "private", "match"]);

function assertNoPrivateData(value: unknown): void {
	if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			expect(privateKeys.has(key)).toBe(false);
			assertNoPrivateData(child);
		}
	}
}

/** Every HTTP JSON is checked; assertion failures never print credentials. */
function httpHarness(store = new RoomStore()) {
	const app = createApp({ roomStore: store });
	const tokens: string[] = [];
	async function post(path: string, body: unknown) {
		const response = await app.request(path, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		const json = (await response.json()) as SeatAdmission;
		assertNoPrivateData(json);
		const serialized = JSON.stringify(json);
		for (const token of tokens) {
			expect(serialized.includes(token)).toBe(false);
		}
		if (response.status < 400) {
			expect(
				typeof json.seat.token === "string" &&
					tokenPattern.test(json.seat.token)
			).toBe(true);
			expect(JSON.stringify(json.state).includes("token")).toBe(false);
			expect(json.state.viewerSeatId).toBe(json.seat.id);
			tokens.push(json.seat.token);
		}
		return { json, status: response.status };
	}
	return { app, post, store };
}

/** HTTP seats are disconnected; connected fixtures always opt in explicitly. */
async function roomFixture(
	count: number,
	connected: boolean,
	store = new RoomStore()
) {
	const http = httpHarness(store);
	const created = await http.post("/api/rooms", { nickname: "Host" });
	const first = created.json as SeatAdmission;
	const { code } = first.state;
	const joined = await Promise.all(
		Array.from({ length: count - 1 }, (_, offset) =>
			http.post(`/api/rooms/${code}/join`, { nickname: `Player ${offset + 1}` })
		)
	);
	const admissions = [first, ...joined.map(({ json }) => json)];
	if (connected) {
		for (const { seat } of admissions) {
			store.markConnected(code, seat.id);
		}
	}
	return { ...http, admissions, code, hostId: first.seat.id };
}

function errorCode(command: () => unknown): RoomErrorCode | undefined {
	try {
		command();
	} catch (error) {
		if (error instanceof RoomError) {
			return error.code;
		}
		throw error;
	}
	return undefined;
}

function assertHttpError(
	result: { json: unknown; status: number },
	code: RoomErrorCode,
	status: number
) {
	expect(result.status).toBe(status);
	expect(result.json).toEqual({ error: { code } });
}

describe("room HTTP nickname boundaries and schemas", () => {
	for (const nickname of ["A", "1234567890123456"]) {
		test(`create and join accept ${nickname.length}-character nicknames`, async () => {
			const http = httpHarness();
			const created = await http.post("/api/rooms", { nickname });
			expect(created.status).toBe(201);
			expect(created.json.seat.nickname).toBe(nickname);
			const joined = await http.post(
				`/api/rooms/${created.json.state.code}/join`,
				{ nickname }
			);
			expect(joined.status).toBe(200);
			expect(joined.json.seat.nickname).toBe(nickname);
		});
	}
	for (const nickname of ["", " ", "\t\n ", "12345678901234567"]) {
		test(`create and join reject invalid nickname ${JSON.stringify(nickname)}`, async () => {
			const fixture = await roomFixture(1, false);
			assertHttpError(
				await fixture.post("/api/rooms", { nickname }),
				"ILLEGAL_ACTION",
				400
			);
			assertHttpError(
				await fixture.post(`/api/rooms/${fixture.code}/join`, { nickname }),
				"ILLEGAL_ACTION",
				400
			);
			expect(
				fixture.store.getLobby(fixture.code, fixture.hostId).seats.length
			).toBe(1);
		});
	}
	test("trims before enforcing bounds for both create and join", async () => {
		const http = httpHarness();
		const created = await http.post("/api/rooms", {
			nickname: "  1234567890123456 \t",
		});
		expect(created.status).toBe(201);
		expect(created.json.seat.nickname).toBe("1234567890123456");
		const joined = await http.post(
			`/api/rooms/${created.json.state.code}/join`,
			{ nickname: "  Bob  " }
		);
		expect(joined.status).toBe(200);
		expect(joined.json.seat.nickname).toBe("Bob");
	});
	for (const body of [
		{},
		{ nickname: 1 },
		{ nickname: null },
		{ nickname: "A", token: "client-supplied" },
	]) {
		test(`strict HTTP body rejects ${JSON.stringify(body)}`, async () => {
			const fixture = await roomFixture(1, false);
			assertHttpError(
				await fixture.post("/api/rooms", body),
				"ILLEGAL_ACTION",
				400
			);
			assertHttpError(
				await fixture.post(`/api/rooms/${fixture.code}/join`, body),
				"ILLEGAL_ACTION",
				400
			);
		});
	}
	test("malformed JSON returns a sanitized error on both routes", async () => {
		const fixture = await roomFixture(1, false);
		await Promise.all(
			["/api/rooms", `/api/rooms/${fixture.code}/join`].map(async (path) => {
				const response = await fixture.app.request(path, {
					body: "{",
					method: "POST",
				});
				assertHttpError(
					{ json: await response.json(), status: response.status },
					"ILLEGAL_ACTION",
					400
				);
			})
		);
	});
});

describe("room admission and private boundaries", () => {
	test("six-character crypto code, caller-only token and disconnected HTTP seats", async () => {
		const fixture = await roomFixture(4, false);
		expect(fixture.code.length).toBe(6);
		expect(
			[...fixture.code].every((character) =>
				ROOM_CODE_ALPHABET.includes(character)
			)
		).toBe(true);
		expect(new Set(fixture.admissions.map(({ seat }) => seat.token)).size).toBe(
			4
		);
		const state = fixture.store.getLobby(fixture.code, fixture.hostId);
		expect(state.seats.every((seat) => !seat.connected)).toBe(true);
		expect(state.revision).toBe(4);
		expect(state.hostSeatId).toBe(fixture.hostId);
		expect(Object.keys(state).sort()).toEqual([
			"code",
			"hostSeatId",
			"phase",
			"revision",
			"seats",
			"viewerSeatId",
		]);
		for (const seat of state.seats) {
			expect(Object.keys(seat).sort()).toEqual([
				"connected",
				"id",
				"index",
				"nickname",
			]);
		}
	});
	test("four seats and fifth ROOM_FULL over Hono without roster/revision change", async () => {
		const fixture = await roomFixture(4, false);
		const before = fixture.store.getLobby(fixture.code, fixture.hostId);
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Fifth",
			}),
			"ROOM_FULL",
			409
		);
		expect(fixture.store.getLobby(fixture.code, fixture.hostId)).toEqual(
			before
		);
	});
	test("playing roster lock returns MATCH_STARTED, before capacity error", async () => {
		const fixture = await roomFixture(4, true);
		const before = fixture.store.getLobby(fixture.code, fixture.hostId);
		const playing = fixture.store.startMatch(fixture.code, fixture.hostId);
		expect(playing.phase).toBe("playing");
		expect(playing.seats).toEqual(before.seats);
		expect(playing.revision).toBe(before.revision + 1);
		assertNoPrivateData(playing);
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Late",
			}),
			"MATCH_STARTED",
			409
		);
		expect(fixture.store.getLobby(fixture.code, fixture.hostId)).toEqual(
			playing
		);
	});
	test("two-seat playing room rejects joins despite spare capacity", async () => {
		const fixture = await roomFixture(2, true);
		fixture.store.startMatch(fixture.code, fixture.hostId);
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Late",
			}),
			"MATCH_STARTED",
			409
		);
		expect(
			fixture.store.getLobby(fixture.code, fixture.hostId).seats.length
		).toBe(2);
	});
	test("collision generator retries without replacing the original room", async () => {
		const codes = ["AAAAAA", "AAAAAA", "BBBBBB"];
		let calls = 0;
		const http = httpHarness(
			new RoomStore({
				codeGenerator: () => {
					const code = codes[calls] ?? "CCCCCC";
					calls += 1;
					return code;
				},
			})
		);
		const first = await http.post("/api/rooms", { nickname: "First" });
		const second = await http.post("/api/rooms", { nickname: "Second" });
		expect(calls).toBe(3);
		expect(first.json.state.code).toBe("AAAAAA");
		expect(second.json.state.code).toBe("BBBBBB");
		expect(
			http.store.getLobby("AAAAAA", first.json.seat.id).seats[0]?.nickname
		).toBe("First");
	});
	test("app factories have independent stores", async () => {
		const first = createApp();
		const second = createApp();
		const created = await first.request("/api/rooms", {
			body: JSON.stringify({ nickname: "A" }),
			method: "POST",
		});
		const admission = (await created.json()) as SeatAdmission;
		const joined = await second.request(
			`/api/rooms/${admission.state.code}/join`,
			{ body: JSON.stringify({ nickname: "B" }), method: "POST" }
		);
		assertHttpError(
			{ json: await joined.json(), status: joined.status },
			"ROOM_EXPIRED",
			404
		);
	});
	test("returned lobby and caller seat are detached from stored state", async () => {
		const fixture = await roomFixture(1, false);
		const state = fixture.store.getLobby(fixture.code, fixture.hostId);
		const [seat] = state.seats;
		if (seat) {
			seat.nickname = "Changed";
			seat.connected = true;
		}
		state.seats.length = 0;
		expect(
			fixture.store.getLobby(fixture.code, fixture.hostId).seats[0]?.nickname
		).toBe("Host");
		expect(
			fixture.store.getLobby(fixture.code, fixture.hostId).seats[0]?.connected
		).toBe(false);
	});
});

describe("host start and connectivity", () => {
	test("only host can start; rejection leaves phase and revision unchanged", async () => {
		const fixture = await roomFixture(2, true);
		const before = fixture.store.getLobby(fixture.code, fixture.hostId);
		expect(
			errorCode(() => fixture.store.startMatch(fixture.code, "seat-1"))
		).toBe("ILLEGAL_ACTION");
		expect(fixture.store.getLobby(fixture.code, fixture.hostId)).toEqual(
			before
		);
		expect(fixture.store.getMatchState(fixture.code)).toBeNull();
	});
	for (const count of [2, 3, 4]) {
		test(`host starts with ${count} connected seats and privately deals hand one`, async () => {
			const fixture = await roomFixture(count, true);
			const state = fixture.store.startMatch(fixture.code, fixture.hostId);
			assertNoPrivateData(state);
			expect(state.phase).toBe("playing");
			const match = fixture.store.getMatchState(fixture.code);
			expect(match?.public.seats.length).toBe(count);
			expect(match?.public.handNumber).toBe(1);
			expect(match?.private.deck.length).toBe(52);
			expect(
				match?.private.holeCards.every((cards) => cards.length === 2)
			).toBe(true);
			expect(
				errorCode(() => fixture.store.startMatch(fixture.code, fixture.hostId))
			).toBe("MATCH_STARTED");
		});
	}
	for (const connected of [0, 1]) {
		test(`${connected} connected seats cannot start even with four HTTP seats`, async () => {
			const fixture = await roomFixture(4, false);
			if (connected === 1) {
				fixture.store.markConnected(fixture.code, fixture.hostId);
			}
			expect(
				errorCode(() => fixture.store.startMatch(fixture.code, fixture.hostId))
			).toBe("ILLEGAL_ACTION");
			expect(fixture.store.getMatchState(fixture.code)).toBeNull();
			expect(fixture.store.getLobby(fixture.code, fixture.hostId).phase).toBe(
				"lobby"
			);
		});
	}
	test("only connected seats enter the engine while room roster remains locked", async () => {
		const fixture = await roomFixture(4, false);
		fixture.store.markConnected(fixture.code, fixture.hostId);
		fixture.store.markConnected(fixture.code, "seat-2");
		const state = fixture.store.startMatch(fixture.code, fixture.hostId);
		expect(state.seats.length).toBe(4);
		expect(
			fixture.store
				.getMatchState(fixture.code)
				?.public.seats.map((seat) => seat.id)
		).toEqual(["seat-0", "seat-2"]);
	});
	test("lowest connected host transfer ignores connection arrival order and gaps", async () => {
		const fixture = await roomFixture(4, false);
		fixture.store.markConnected(fixture.code, fixture.hostId);
		fixture.store.markConnected(fixture.code, "seat-3");
		fixture.store.markConnected(fixture.code, "seat-2");
		const state = fixture.store.markDisconnected(fixture.code, fixture.hostId);
		expect(state.hostSeatId).toBe("seat-2");
		expect(
			fixture.store.markDisconnected(fixture.code, "seat-2").hostSeatId
		).toBe("seat-3");
	});
	test("all disconnected retains last host until a connected seat can take over", async () => {
		const fixture = await roomFixture(2, true);
		fixture.store.markDisconnected(fixture.code, "seat-1");
		expect(
			fixture.store.markDisconnected(fixture.code, fixture.hostId).hostSeatId
		).toBe(fixture.hostId);
		expect(fixture.store.markConnected(fixture.code, "seat-1").hostSeatId).toBe(
			"seat-1"
		);
	});
	test("playing disconnect never transfers host or alters roster", async () => {
		const fixture = await roomFixture(2, true);
		fixture.store.startMatch(fixture.code, fixture.hostId);
		const state = fixture.store.markDisconnected(fixture.code, fixture.hostId);
		expect(state.hostSeatId).toBe(fixture.hostId);
		expect(state.seats.length).toBe(2);
	});
	test("connection flags are idempotent and unknown seats are AUTH_REQUIRED", async () => {
		const fixture = await roomFixture(2, true);
		const state = fixture.store.getLobby(fixture.code, fixture.hostId);
		expect(fixture.store.markConnected(fixture.code, fixture.hostId)).toEqual(
			state
		);
		expect(
			errorCode(() => fixture.store.markConnected(fixture.code, "unknown"))
		).toBe("AUTH_REQUIRED");
		expect(
			errorCode(() => fixture.store.startMatch(fixture.code, "unknown"))
		).toBe("AUTH_REQUIRED");
	});
});

describe("injectable-clock idle expiry", () => {
	test("idle room exists at 29:59.999", async () => {
		let now = 0;
		const fixture = await roomFixture(
			1,
			false,
			new RoomStore({ now: () => now })
		);
		now = ROOM_IDLE_MS - 1;
		const joined = await fixture.post(`/api/rooms/${fixture.code}/join`, {
			nickname: "Just in time",
		});
		expect(joined.status).toBe(200);
		expect(joined.json.state.seats.length).toBe(2);
	});
	test("idle room at exactly 30:00 returns ROOM_EXPIRED and cannot revive", async () => {
		let now = 0;
		const fixture = await roomFixture(
			2,
			true,
			new RoomStore({ now: () => now })
		);
		fixture.store.startMatch(fixture.code, fixture.hostId);
		now = ROOM_IDLE_MS;
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Too late",
			}),
			"ROOM_EXPIRED",
			404
		);
		expect(errorCode(() => fixture.store.getMatchState(fixture.code))).toBe(
			"ROOM_EXPIRED"
		);
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Retry",
			}),
			"ROOM_EXPIRED",
			404
		);
	});
	test("unknown and invalid codes use the same ROOM_EXPIRED error", async () => {
		const fixture = httpHarness();
		await Promise.all(
			["AAAAAA", "unknown", "123456"].map(async (code) => {
				assertHttpError(
					await fixture.post(`/api/rooms/${code}/join`, { nickname: "A" }),
					"ROOM_EXPIRED",
					404
				);
			})
		);
	});
	test("successful requests and rejected requests touch idle activity", async () => {
		let now = 0;
		const fixture = await roomFixture(
			4,
			false,
			new RoomStore({ now: () => now })
		);
		now = ROOM_IDLE_MS - 1;
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Fifth",
			}),
			"ROOM_FULL",
			409
		);
		now += ROOM_IDLE_MS - 1;
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, { nickname: " " }),
			"ILLEGAL_ACTION",
			400
		);
		now += ROOM_IDLE_MS - 1;
		expect(
			fixture.store.getLobby(fixture.code, fixture.hostId).seats.length
		).toBe(4);
		now += ROOM_IDLE_MS;
		assertHttpError(
			await fixture.post(`/api/rooms/${fixture.code}/join`, {
				nickname: "Late",
			}),
			"ROOM_EXPIRED",
			404
		);
	});
	test("connection and start commands also touch the injected clock", async () => {
		let now = 0;
		const fixture = await roomFixture(
			2,
			false,
			new RoomStore({ now: () => now })
		);
		now = ROOM_IDLE_MS - 1;
		fixture.store.markConnected(fixture.code, fixture.hostId);
		now += ROOM_IDLE_MS - 1;
		fixture.store.markConnected(fixture.code, "seat-1");
		now += ROOM_IDLE_MS - 1;
		expect(fixture.store.startMatch(fixture.code, fixture.hostId).phase).toBe(
			"playing"
		);
	});
});

describe("test-only deck injection", () => {
	test("constructor accepts a deterministic function and private reads are detached", async () => {
		let calls = 0;
		const fixture = await roomFixture(
			2,
			true,
			new RoomStore({
				deckSource: () => {
					calls += 1;
					return fullDeck();
				},
			})
		);
		fixture.store.startMatch(fixture.code, fixture.hostId);
		expect(calls).toBe(1);
		const match = fixture.store.getMatchState(fixture.code);
		expect(match?.private.deck.length).toBe(52);
		if (match) {
			match.private.deck.length = 0;
		}
		expect(fixture.store.getMatchState(fixture.code)?.private.deck.length).toBe(
			52
		);
	});
	test("failed injected deck leaves room in lobby without partial mutation", async () => {
		const fixture = await roomFixture(
			2,
			true,
			new RoomStore({ deckSource: () => [] })
		);
		const before = fixture.store.getLobby(fixture.code, fixture.hostId);
		expect(() =>
			fixture.store.startMatch(fixture.code, fixture.hostId)
		).toThrow("Deck source must supply a complete 52-card permutation");
		expect(fixture.store.getLobby(fixture.code, fixture.hostId)).toEqual(
			before
		);
		expect(fixture.store.getMatchState(fixture.code)).toBeNull();
	});
	test("production app constructs RoomStore without deck configuration or env selectors", async () => {
		const appSource = await Bun.file(`${import.meta.dir}/app.ts`).text();
		const entrySource = await Bun.file(`${import.meta.dir}/index.ts`).text();
		const roomSource = await Bun.file(`${import.meta.dir}/rooms.ts`).text();
		expect(productionStorePattern.test(appSource)).toBe(true);
		expect(appSource.includes("deckSource")).toBe(false);
		expect(entrySource.includes("deckSource")).toBe(false);
		expect(environmentPattern.test(roomSource)).toBe(false);
	});
});
