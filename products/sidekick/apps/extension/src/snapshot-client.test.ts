import { describe, expect, test } from "bun:test";
import type { Snapshot } from "./page/snapshot";
import {
	type AccessPause,
	observeTab,
	requestOriginAccess,
	type SnapshotBrowser,
} from "./snapshot-client";

function fixture(
	url = "https://en.wikipedia.org/wiki/Ada_Lovelace",
	granted = false
) {
	const calls: { operation: string; value?: unknown }[] = [];
	const snapshot: Snapshot = {
		documentToken: "document-token",
		elements: [],
		snapshotId: "snapshot-id",
		tabId: 7,
		text: "Rendered text",
		title: "Fixture page",
		truncated: false,
		url,
	};
	const api: SnapshotBrowser = {
		permissions: {
			contains: (value) => {
				calls.push({ operation: "contains", value });
				return Promise.resolve(granted);
			},
			request: (value) => {
				calls.push({ operation: "request", value });
				return Promise.resolve(true);
			},
		},
		scripting: {
			executeScript: (value) => {
				calls.push({ operation: "inject", value });
				return Promise.resolve([]);
			},
		},
		tabs: {
			get: () => Promise.resolve({ url }),
			sendMessage: (tabId, message, options) => {
				calls.push({
					operation: "message",
					value: { message, options, tabId },
				});
				return Promise.resolve(snapshot);
			},
		},
	};
	return { api, calls, snapshot };
}

describe("panel snapshot access flow", () => {
	test("missing optional permission pauses without injecting or prompting automatically", async () => {
		const { api, calls } = fixture();
		expect(await observeTab(7, api)).toMatchObject({
			canRequestAccess: true,
			origin: "https://en.wikipedia.org/*",
			reason: "permission-required",
			status: "paused",
		});
		expect(calls.map((call) => call.operation)).toEqual(["contains"]);
	});

	test("an explicit user gesture requests only the exact allowed origin synchronously", async () => {
		const { api, calls } = fixture("https://httpbin.org/forms/post");
		const result = await observeTab(7, api);
		expect(result.status).toBe("paused");
		const request = requestOriginAccess(result as AccessPause, api);
		expect(calls.at(-1)).toEqual({
			operation: "request",
			value: { origins: ["https://httpbin.org/*"] },
		});
		expect(await request).toBe(true);
	});

	test("granted origin uses the existing isolated frame-0 packaged descriptor then frame-0 messaging", async () => {
		const { api, calls, snapshot } = fixture(undefined, true);
		expect(await observeTab(7, api)).toEqual({ snapshot, status: "ready" });
		expect(calls[1]).toEqual({
			operation: "inject",
			value: {
				files: ["content-scripts/content.js"],
				target: { frameIds: [0], tabId: 7 },
				world: "ISOLATED",
			},
		});
		expect(calls[2]).toEqual({
			operation: "message",
			value: {
				message: { tabId: 7, type: "sidekick:observe" },
				options: { frameId: 0 },
				tabId: 7,
			},
		});
	});
	test("targeted queries are forwarded only to the selected top frame", async () => {
		const { api, calls, snapshot } = fixture(undefined, true);
		expect(await observeTab(7, api, "published work")).toEqual({
			snapshot,
			status: "ready",
		});
		expect(calls[2]).toEqual({
			operation: "message",
			value: {
				message: {
					query: "published work",
					tabId: 7,
					type: "sidekick:observe",
				},
				options: { frameId: 0 },
				tabId: 7,
			},
		});
	});
	test("unsupported origins, forged broad permissions and protected URLs never request access", async () => {
		await Promise.all(
			[
				"https://example.com/",
				"chrome://settings",
				"file:///tmp/test.html",
				"javascript:alert(1)",
			].map(async (url) => {
				const { api, calls } = fixture(url);
				const result = await observeTab(7, api);
				expect(result.status).toBe("paused");
				expect(await requestOriginAccess(result as AccessPause, api)).toBe(
					false
				);
				expect(
					calls.some(
						(call) =>
							call.operation === "request" || call.operation === "inject"
					)
				).toBe(false);
			})
		);
		const { api, calls } = fixture();
		expect(
			await requestOriginAccess(
				{
					canRequestAccess: true,
					message: "",
					origin: "<all_urls>",
					reason: "permission-required",
					status: "paused",
					tabId: 7,
				},
				api
			)
		).toBe(false);
		expect(calls).toHaveLength(0);
	});

	test("permission denial can be surfaced without any injection", async () => {
		const { api, calls } = fixture();
		api.permissions.request = () => Promise.resolve(false);
		const result = await observeTab(7, api);
		expect(await requestOriginAccess(result as AccessPause, api)).toBe(false);
		expect(calls.some((call) => call.operation === "inject")).toBe(false);
	});

	test("closed/protected tabs and malformed content responses return a clear pause", async () => {
		const closed = fixture(undefined, true);
		closed.api.tabs.get = () => Promise.reject(new Error("No tab"));
		expect(await observeTab(7, closed.api)).toMatchObject({
			reason: "injection-failed",
			status: "paused",
		});
		const malformed = fixture(undefined, true);
		malformed.api.tabs.sendMessage = () => Promise.resolve({ tabId: 999 });
		expect(await observeTab(7, malformed.api)).toMatchObject({
			reason: "injection-failed",
			status: "paused",
		});
	});
});
