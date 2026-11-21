import { describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { Action } from "../../../../packages/protocol/src";
import { createActionDispatcher } from "../action-dispatcher";
import type { SnapshotBrowser } from "../snapshot-client";
import {
	createPageDispatcher,
	type DispatchResult,
	type PageActionExecutor,
	type RunBinding,
} from "./dispatch";
import { createSnapshotObserver } from "./snapshot";

function fixture(executor?: PageActionExecutor) {
	const window = new Window({ url: "https://example.test/form" });
	window.document.write(
		'<!doctype html><title>Dispatch fixture</title><body><button id="first" type="button">First</button><button id="second" type="button">Second</button><label for="name">Name</label><input id="name" name="name"><a id="link" href="/reference">Reference</a></body>'
	);
	window.HTMLElement.prototype.getClientRects = () =>
		[{ height: 20, width: 100 }] as ReturnType<
			Window["HTMLElement"]["prototype"]["getClientRects"]
		>;
	const document = window.document as unknown as Document;
	const observer = createSnapshotObserver(document);
	let mutations = 0;
	const invoked: Element[] = [];
	const dispatcher = createPageDispatcher(
		document,
		observer,
		executor ??
			((_action, target) => {
				if (target) {
					mutations += 1;
					invoked.push(target);
					(target as HTMLElement).click();
				}
			})
	);
	const snapshot = dispatcher.observe(42);
	const binding: RunBinding = {
		documentToken: snapshot.documentToken,
		runId: "run-1",
		snapshotId: snapshot.snapshotId,
		tabId: 42,
	};
	expect(dispatcher.bindRun(binding)).toEqual({ status: "ready" });
	const action: Action = {
		...binding,
		actionId: "action-1",
		args: { index: 1 },
		preview: "Click First",
		tool: "click",
	};
	return {
		action,
		binding,
		dispatcher,
		document,
		invoked,
		mutations: () => mutations,
		observer,
		snapshot,
		window,
	};
}

function expectStale(
	f: ReturnType<typeof fixture>,
	input: unknown,
	reason: Extract<DispatchResult, { status: "stale-target" }>["reason"]
) {
	expect(f.dispatcher.dispatch(input)).toEqual({
		reason,
		reobserveRequired: true,
		status: "stale-target",
	});
	expect(f.mutations()).toBe(0);
}

describe("recorded-element dispatch preflight", () => {
	test("a matching target invokes exactly once and never resolves a fallback selector", () => {
		const f = fixture();
		const lookup = spyOn(f.observer, "resolveElement");
		expect(f.dispatcher.dispatch(f.action)).toEqual({
			actionId: "action-1",
			reobserveRequired: true,
			runId: "run-1",
			status: "dispatched",
		});
		expect(f.mutations()).toBe(1);
		expect(f.invoked).toEqual([f.document.getElementById("first") as Element]);
		// Exactly one lookup in the existing registry, using only the recorded index.
		expect(lookup.mock.calls).toEqual([
			[f.action.snapshotId, f.action.documentToken, 1],
		]);
		lookup.mockRestore();
		expect(f.dispatcher.dispatch(f.action)).toMatchObject({
			reason: "duplicate-action",
			reobserveRequired: true,
			status: "stale-target",
		});
		expect(f.mutations()).toBe(1);
	});

	const changes: [string, (document: Document) => void][] = [
		["removed", (document) => document.getElementById("first")?.remove()],
		[
			"replaced by an identical clone",
			(document) => {
				const element = document.getElementById("first");
				element?.replaceWith(element.cloneNode(true));
			},
		],
		[
			"reordered",
			(document) => {
				const first = document.getElementById("first");
				const second = document.getElementById("second");
				if (first && second) {
					first.before(second);
				}
			},
		],
		[
			"hidden",
			(document) =>
				document.getElementById("first")?.setAttribute("hidden", ""),
		],
		[
			"CSS invisible",
			(document) =>
				document.getElementById("first")?.setAttribute("style", "display:none"),
		],
		[
			"disabled",
			(document) =>
				document.getElementById("first")?.setAttribute("disabled", ""),
		],
		[
			"aria-disabled",
			(document) =>
				document.getElementById("first")?.setAttribute("aria-disabled", "true"),
		],
		[
			"renamed",
			(document) => {
				const first = document.getElementById("first");
				if (first) {
					first.textContent = "Submit instead";
				}
			},
		],
		[
			"retagged semantics",
			(document) =>
				document.getElementById("first")?.setAttribute("type", "submit"),
		],
		[
			"reparented",
			(document) => {
				const parent = document.createElement("div");
				document.body.append(parent);
				const first = document.getElementById("first");
				if (first) {
					parent.append(first);
				}
			},
		],
	];
	for (const [name, change] of changes) {
		test(`${name} controls require observation with zero mutations`, () => {
			const f = fixture();
			change(f.document);
			expectStale(f, f.action, "target-changed");
		});
	}

	test("a changed link destination is stale even when the same node survives", () => {
		const f = fixture();
		const index = f.snapshot.elements.find(
			(element) => element.role === "link"
		)?.index;
		f.document.getElementById("link")?.setAttribute("href", "/different");
		expectStale(f, { ...f.action, args: { index } }, "target-changed");
	});

	test("base URL changes cannot silently retarget an unchanged link", () => {
		const f = fixture();
		const index = f.snapshot.elements.find(
			(element) => element.role === "link"
		)?.index;
		const base = f.document.createElement("base");
		base.href = "https://other.test/";
		f.document.head.append(base);
		expectStale(f, { ...f.action, args: { index } }, "target-changed");
	});

	test("hiding an external native label invalidates the observed field name", () => {
		const f = fixture();
		const index = f.snapshot.elements.find(
			(element) => element.inputType === "text"
		)?.index;
		f.document.querySelector("label")?.setAttribute("hidden", "");
		expectStale(
			f,
			{ ...f.action, args: { index, value: "dummy" }, tool: "fill" },
			"target-changed"
		);
	});

	test("an externally changed native label invalidates a fill target", () => {
		const f = fixture();
		const index = f.snapshot.elements.find(
			(element) => element.inputType === "text"
		)?.index;
		const label = f.document.querySelector("label");
		if (label) {
			label.textContent = "Payment details";
		}
		expectStale(
			f,
			{ ...f.action, args: { index, value: "dummy" }, tool: "fill" },
			"target-changed"
		);
	});

	test("unknown index has no selector fallback and zero mutations", () => {
		const f = fixture();
		const lookup = spyOn(f.observer, "resolveElement");
		expectStale(f, { ...f.action, args: { index: 999 } }, "unknown-index");
		expect(lookup).not.toHaveBeenCalled();
		lookup.mockRestore();
	});

	for (const [field, value, reason] of [
		["runId", "old-run", "inactive-run"],
		["tabId", 43, "tab-changed"],
		["snapshotId", "old-snapshot", "snapshot-changed"],
		["documentToken", "old-document", "document-changed"],
	] as const) {
		test(`changed ${field} rejects before execution`, () => {
			const f = fixture();
			expectStale(f, { ...f.action, [field]: value }, reason);
		});
	}

	test("fresh observation makes the old index map stale", () => {
		const f = fixture();
		f.dispatcher.observe(42);
		expectStale(f, f.action, "snapshot-changed");
	});

	test("snapshot registry invalidation is checked immediately before dispatch", () => {
		const f = fixture();
		f.observer.observe(42);
		expectStale(f, f.action, "snapshot-changed");
	});

	test("document-root replacement rejects old document tokens", () => {
		const f = fixture();
		const root = f.document.createElement("html");
		root.innerHTML = "<head></head><body><button>Replacement</button></body>";
		f.document.documentElement.remove();
		f.document.appendChild(root);
		expectStale(f, f.action, "document-changed");
	});

	test("same-document URL navigation also invalidates target identity", () => {
		const f = fixture();
		f.window.history.pushState({}, "", "/other");
		expectStale(f, f.action, "document-changed");
	});

	test("a newly loaded document has no active run and cannot accept an old action", () => {
		const f = fixture();
		const next = fixture();
		expectStale(next, f.action, "document-changed");
	});

	test("new active run rejects a queued action from the previous run", () => {
		const f = fixture();
		expect(f.dispatcher.bindRun({ ...f.binding, runId: "run-2" })).toEqual({
			status: "ready",
		});
		expectStale(f, f.action, "inactive-run");
	});

	test("a stale response can be recovered only with fresh observation and a new action", () => {
		const f = fixture();
		f.document.getElementById("first")?.remove();
		expectStale(f, f.action, "target-changed");
		const fresh = f.dispatcher.observe(42);
		const action = {
			...f.action,
			actionId: "action-2",
			args: { index: 1 },
			snapshotId: fresh.snapshotId,
		};
		expect(f.dispatcher.dispatch(action).status).toBe("dispatched");
		expect(f.invoked).toEqual([f.document.getElementById("second") as Element]);
		expect(f.mutations()).toBe(1);
	});

	test("an uncertain executor exception is Unverified, consumed, and never replayed", () => {
		let mutations = 0;
		const f = fixture(() => {
			mutations += 1;
			throw new Error("uncertain mutation");
		});
		expect(f.dispatcher.dispatch(f.action)).toEqual({
			reason: "dispatch-unavailable",
			reobserveRequired: true,
			status: "unverified",
		});
		expect(f.dispatcher.dispatch(f.action)).toMatchObject({
			reason: "duplicate-action",
			status: "stale-target",
		});
		expect(mutations).toBe(1);
	});

	const malformed: [string, (action: Action) => unknown][] = [
		["missing envelope", () => undefined],
		[
			"missing identity",
			(action) => {
				const { documentToken: _ignored, ...rest } = action;
				return rest;
			},
		],
		["blank run", (action) => ({ ...action, runId: " " })],
		["fractional tab", (action) => ({ ...action, tabId: 1.5 })],
		["negative index", (action) => ({ ...action, args: { index: -1 } })],
		["string index", (action) => ({ ...action, args: { index: "1" } })],
		["missing preview", (action) => ({ ...action, preview: undefined })],
		[
			"javascript tool",
			(action) => ({
				...action,
				args: { code: "globalThis.compromised = true" },
				tool: "eval",
			}),
		],
		[
			"code in args",
			(action) => ({
				...action,
				args: { code: "globalThis.compromised = true", index: 1 },
			}),
		],
		[
			"extra model func",
			(action) => ({ ...action, func: "globalThis.compromised = true" }),
		],
		[
			"non-HTTP destination",
			(action) => ({
				...action,
				args: { url: "javascript:alert(1)" },
				tool: "openTab",
			}),
		],
	];
	for (const [name, input] of malformed) {
		test(`malformed ${name}: zero mutations and explicit re-observation`, () => {
			const f = fixture();
			expect(f.dispatcher.dispatch(input(f.action))).toEqual({
				reason: "malformed-envelope",
				reobserveRequired: true,
				status: "invalid-action",
			});
			expect(f.mutations()).toBe(0);
		});
	}
});

function boundaryFixture() {
	const f = fixture();
	const injections: unknown[] = [];
	const messages: unknown[] = [];
	const api: Pick<SnapshotBrowser, "scripting" | "tabs"> = {
		scripting: {
			executeScript: (injection) => {
				injections.push(injection);
				return Promise.resolve([]);
			},
		},
		tabs: {
			get: () => Promise.resolve({ url: f.snapshot.url }),
			sendMessage: (tabId, message, options) => {
				messages.push({ message, options, tabId });
				const request = message as {
					type: string;
					binding?: unknown;
					action?: unknown;
				};
				return Promise.resolve(
					request.type === "sidekick:bind-run"
						? f.dispatcher.bindRun(request.binding)
						: f.dispatcher.dispatch(request.action)
				);
			},
		},
	};
	return {
		...f,
		api,
		client: createActionDispatcher(api),
		injections,
		messages,
	};
}

describe("isolated packaged-script boundary", () => {
	test("valid action passes only the fixed packaged file to chrome.scripting, once per dispatch", async () => {
		const f = boundaryFixture();
		expect(await f.client.bindRun(f.binding)).toEqual({ status: "ready" });
		f.injections.length = 0;
		f.messages.length = 0;
		expect((await f.client.dispatch(f.action)).status).toBe("dispatched");
		expect(f.injections).toEqual([
			{
				files: ["content-scripts/content.js"],
				target: { frameIds: [0], tabId: 42 },
				world: "ISOLATED",
			},
		]);
		expect(f.messages).toEqual([
			{
				message: { action: f.action, type: "sidekick:dispatch" },
				options: { frameId: 0 },
				tabId: 42,
			},
		]);
		expect(f.mutations()).toBe(1);
	});

	test("malformed envelopes cannot reach chrome.scripting or messaging", async () => {
		const f = boundaryFixture();
		expect(
			(await f.client.dispatch({ ...f.action, func: "alert(1)" })).status
		).toBe("invalid-action");
		expect(f.injections).toHaveLength(0);
		expect(f.messages).toHaveLength(0);
		expect(f.mutations()).toBe(0);
	});

	test("inactive run cannot reach chrome.scripting", async () => {
		const f = boundaryFixture();
		expect(await f.client.dispatch(f.action)).toMatchObject({
			reason: "inactive-run",
			status: "stale-target",
		});
		expect(f.injections).toHaveLength(0);
		expect(f.mutations()).toBe(0);
	});

	test("run changes during injection invalidate queued dispatch before messaging", async () => {
		const f = boundaryFixture();
		await f.client.bindRun(f.binding);
		let resume: (() => void) | undefined;
		f.api.scripting.executeScript = () =>
			new Promise((resolve) => {
				resume = () => resolve([]);
			});
		const queued = f.client.dispatch(f.action);
		f.api.scripting.executeScript = () => Promise.resolve([]);
		await f.client.bindRun({ ...f.binding, runId: "run-2" });
		resume?.();
		expect(await queued).toMatchObject({
			reason: "inactive-run",
			status: "stale-target",
		});
		expect(f.mutations()).toBe(0);
	});

	test("navigation during packaged injection rejects old target with zero mutations", async () => {
		const f = boundaryFixture();
		await f.client.bindRun(f.binding);
		f.api.scripting.executeScript = () => {
			f.document.getElementById("first")?.remove();
			return Promise.resolve([]);
		};
		expect(await f.client.dispatch(f.action)).toMatchObject({
			reason: "target-changed",
			reobserveRequired: true,
			status: "stale-target",
		});
		expect(f.mutations()).toBe(0);
	});

	test("uncertain transport never retries or reports Success", async () => {
		const f = boundaryFixture();
		await f.client.bindRun(f.binding);
		let calls = 0;
		f.api.tabs.sendMessage = () => {
			calls += 1;
			f.dispatcher.dispatch(f.action);
			return Promise.reject(new Error("channel closed"));
		};
		expect(await f.client.dispatch(f.action)).toEqual({
			reason: "dispatch-unavailable",
			reobserveRequired: true,
			status: "unverified",
		});
		expect(calls).toBe(1);
		expect(f.mutations()).toBe(1);
	});
});
