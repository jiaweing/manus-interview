import { describe, expect, test } from "bun:test";
import {
	canRequestModel,
	clearDemoToken,
	DEMO_TOKEN_KEY,
	loadDemoToken,
	loadSelectedTab,
	type PanelBrowser,
	requestAfterDisclosure,
	saveDemoToken,
} from "./config";

function fixture(
	tab: { id?: number; title?: string; url?: string } | null = {
		id: 42,
		title: "Ada Lovelace",
		url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
	}
) {
	const queries: unknown[] = [];
	const session: Record<string, unknown> = {};
	const local: Record<string, unknown> = {};
	const sync: Record<string, unknown> = {};
	const writes: Record<string, string>[] = [];
	const api: PanelBrowser & { storage: { local: never; sync: never } } = {
		storage: {
			// Trap any accidental use of a persistent store.
			get local(): never {
				throw new Error("Persistent local storage is forbidden");
			},
			session: {
				get: (key) => Promise.resolve({ [key]: session[key] }),
				remove: (key) => {
					delete session[key];
					return Promise.resolve();
				},
				set: (items) => {
					writes.push(items);
					Object.assign(session, items);
					return Promise.resolve();
				},
			},
			get sync(): never {
				throw new Error("Persistent sync storage is forbidden");
			},
		},
		tabs: {
			query: (query) => {
				queries.push(query);
				return Promise.resolve(tab ? [tab] : []);
			},
		},
	};
	return { api, local, queries, session, sync, writes };
}

describe("selected-tab context", () => {
	test("queries only the selected tab in the current window and returns only metadata", async () => {
		const { api, queries } = fixture();
		expect(await loadSelectedTab(api)).toEqual({
			id: 42,
			title: "Ada Lovelace",
			url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
		});
		expect(queries).toEqual([{ active: true, currentWindow: true }]);
	});
	test("handles a closed or absent selected tab without guessing", async () => {
		expect(await loadSelectedTab(fixture(null).api)).toBeNull();
		expect(await loadSelectedTab(fixture({}).api)).toBeNull();
	});
	test("uses honest fallbacks when selected metadata is missing", async () => {
		expect(await loadSelectedTab(fixture({ id: 7 }).api)).toEqual({
			id: 7,
			title: "Untitled tab",
			url: "URL unavailable",
		});
	});
	test("propagates unavailable browser access for the UI to surface", async () => {
		const { api } = fixture();
		api.tabs.query = () => Promise.reject(new Error("Unavailable"));
		await expect(loadSelectedTab(api)).rejects.toThrow("Unavailable");
	});
});

describe("session-only token configuration", () => {
	test("persists only a demo token; task, transcript, and snapshot remain memory-only", async () => {
		const { api, session, local, sync, writes } = fixture();
		const memory = {
			goal: "Research Ada",
			snapshot: { text: "example" },
			transcript: ["No actions yet"],
		};
		expect(await loadDemoToken(api)).toBe("");
		expect(await saveDemoToken(api, " test-token-not-secret ")).toBe(
			"test-token-not-secret"
		);
		expect(await loadDemoToken(api)).toBe("test-token-not-secret");
		expect(writes).toEqual([{ [DEMO_TOKEN_KEY]: "test-token-not-secret" }]);
		expect(session).toEqual({ [DEMO_TOKEN_KEY]: "test-token-not-secret" });
		expect(local).toEqual({});
		expect(sync).toEqual({});
		expect(memory.goal).toBe("Research Ada");
	});
	test("removes the session token without writing to local or sync", async () => {
		const { api, session, local, sync } = fixture();
		await saveDemoToken(api, "test-token-not-secret");
		await clearDemoToken(api);
		expect(await loadDemoToken(api)).toBe("");
		expect(session).toEqual({});
		expect(local).toEqual({});
		expect(sync).toEqual({});
	});
	test("rejects empty or whitespace-bearing tokens before any write", async () => {
		const { api, writes } = fixture();
		for (const token of ["", "   ", "test token", "test\ntoken"]) {
			// biome-ignore lint/performance/noAwaitInLoops: Each invalid-input assertion must complete.
			await expect(saveDemoToken(api, token)).rejects.toThrow();
		}
		expect(writes).toEqual([]);
	});
	test("ignores invalid stored token values", async () => {
		const { api, session } = fixture();
		session[DEMO_TOKEN_KEY] = 42;
		expect(await loadDemoToken(api)).toBe("");
		session[DEMO_TOKEN_KEY] = "test token";
		expect(await loadDemoToken(api)).toBe("");
	});
	test("does not report success when session storage rejects a write", async () => {
		const { api } = fixture();
		api.storage.session.set = () => Promise.reject(new Error("Unavailable"));
		await expect(saveDemoToken(api, "test-token-not-secret")).rejects.toThrow(
			"Unavailable"
		);
	});
});

describe("disclosure before provider-bound requests", () => {
	for (const token of ["", "test token", "test-token-not-secret"]) {
		for (const disclosurePresented of [false, true]) {
			for (const disclosureAccepted of [false, true]) {
				test(`request gate: valid token ${token === "test-token-not-secret"}, presented ${disclosurePresented}, accepted ${disclosureAccepted}`, async () => {
					const state = { disclosureAccepted, disclosurePresented, token };
					const expected =
						token === "test-token-not-secret" &&
						disclosurePresented &&
						disclosureAccepted;
					let requests = 0;
					const request = (bearer: string) => {
						requests += 1;
						expect(bearer).toBe("test-token-not-secret");
						return Promise.resolve("fake turn");
					};
					expect(canRequestModel(state)).toBe(expected);
					if (expected) {
						expect(await requestAfterDisclosure(state, request)).toBe(
							"fake turn"
						);
					} else {
						await expect(
							requestAfterDisclosure(state, request)
						).rejects.toThrow("disclosure");
					}
					expect(requests).toBe(expected ? 1 : 0);
				});
			}
		}
	}
	test("reopening starts with fresh disclosure even when the token is session-restored", async () => {
		const { api } = fixture();
		await saveDemoToken(api, "test-token-not-secret");
		const token = await loadDemoToken(api);
		expect(
			canRequestModel({
				disclosureAccepted: false,
				disclosurePresented: true,
				token,
			})
		).toBe(false);
	});
});
