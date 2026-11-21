import { describe, expect, test } from "bun:test";
import { write } from "bun";
import { Window } from "happy-dom";
import {
	snapshotSchema,
	turnRequestSchema,
} from "../../../../packages/protocol/src";
import { createOpenRouterAdapter } from "../../../server/src/agent/openrouter";
import { serializedPrivacyPayload } from "../../tests/privacy-provider";
import { isExposed } from "./exposure";
import {
	exposedPositiveFixture,
	exposureCases,
	exposureFixture,
} from "./fixtures/exposure-matrix";
import { createSnapshotObserver } from "./snapshot";

async function assertPrivateProviderPayload(
	observer: ReturnType<typeof createSnapshotObserver>,
	sentinel: string
) {
	const snapshot = observer.observe(7);
	const targeted = observer.observe(7, sentinel);
	const request = turnRequestSchema.parse({
		goal: "Read permitted evidence",
		messages: [],
		snapshot,
	});
	let providerBody = "";
	const adapter = createOpenRouterAdapter(
		{ OPENROUTER_API_KEY: "test-token-not-secret" },
		((_url, options) => {
			providerBody = String(options?.body);
			return Promise.resolve(
				Response.json({
					choices: [
						{
							finish_reason: "stop",
							message: { content: "Done", role: "assistant" },
						},
					],
				})
			);
		}) as typeof fetch
	);
	await adapter?.turn(request, new AbortController().signal);
	expect(providerBody).toContain("UNTRUSTED_PAGE_SNAPSHOT_JSON");
	expect(JSON.stringify(snapshot)).not.toContain(sentinel);
	expect(JSON.stringify(targeted)).not.toContain(sentinel);
	expect(targeted.text).toBe("");
	expect(targeted.elements).toEqual([]);
	expect(providerBody).not.toContain(sentinel);
}

function fixture(body: string) {
	const window = new Window({ url: "https://httpbin.org/forms/post" });
	window.document.write(
		`<html><head><title>Privacy fixture</title><style>[hidden='until-found'] { content-visibility:hidden }</style></head><body>${body}</body></html>`
	);
	// Happy DOM has no layout. Browser verification uses Chromium's native layout.
	// It also lacks Chromium's until-found UA style, modeled above; explicit
	// content-visibility:visible overrides remain exposed in the positive fixture.
	window.HTMLElement.prototype.getClientRects = () =>
		[{ height: 20, width: 100 }] as ReturnType<
			Window["HTMLElement"]["prototype"]["getClientRects"]
		>;
	const document = window.document as unknown as Document;
	return { document, observer: createSnapshotObserver(document), window };
}

function assertBounded(
	snapshot: ReturnType<ReturnType<typeof createSnapshotObserver>["observe"]>
) {
	expect(snapshot.text.length).toBeLessThanOrEqual(20_000);
	expect(snapshot.elements.length).toBeLessThanOrEqual(300);
	expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
}

describe("bounded private snapshots", () => {
	for (const entry of exposureCases) {
		test(`one exposure boundary: ${entry.kind}`, async () => {
			const sentinel = `exposure-${crypto.randomUUID()}`;
			const { observer, document, window } = fixture(
				exposureFixture(entry, sentinel)
			);
			try {
				// Happy DOM has no render skipping. Simulate only the browser-owned
				// checkVisibility result; every structural exclusion uses the real DOM.
				if (entry.nativeSkipped) {
					for (const element of document.querySelectorAll(
						"#private-source, #mixed-hidden"
					)) {
						Object.defineProperty(element, "checkVisibility", {
							value: () => false,
						});
					}
				}
				const snapshot = observer.observe(7);
				const targeted = observer.observe(7, sentinel);
				const found = observer.findText(7, sentinel);
				const nearby = observer.observe(7, "Permitted");
				const providerBody = await serializedPrivacyPayload(snapshot, [
					targeted,
					found,
					nearby,
				]);
				expect(snapshot.text).toContain("Permitted heading");
				expect(providerBody).toContain("UNTRUSTED_PAGE_SNAPSHOT_JSON");
				for (const result of [snapshot, targeted, found, nearby]) {
					assertBounded(result);
					expect(JSON.stringify(result)).not.toContain(sentinel);
				}
				for (const result of [targeted, found]) {
					expect(result.text).toBe("");
					expect(result.elements).toEqual([]);
				}
				expect(providerBody).not.toContain(sentinel);
			} finally {
				window.close();
			}
		});
	}

	test("exposed summaries, open disclosures, rendered until-found and false aria-hidden remain readable", () => {
		const { observer, document, window } = fixture(exposedPositiveFixture);
		try {
			const snapshot = observer.observe(7);
			for (const text of [
				"Visible closed summary",
				"Visible summary control",
				"Visible open body",
				"Visible open control",
				"Visible dialog body",
				"Visible dialog control",
				"Visible until-found override",
				"Visible until-found control",
				"Visible false aria-hidden",
				"Visible description",
			]) {
				expect(snapshot.text).toContain(text);
			}
			expect(snapshot.text).not.toContain("Hidden body");
			expect(
				snapshot.elements.some((entry) => entry.name === "Visible description")
			).toBe(true);
			const details = document.querySelector("details");
			const body = details?.lastChild ?? null;
			expect(isExposed(body)).toBe(false);
			details?.setAttribute("open", "");
			expect(isExposed(body)).toBe(true);
			expect(observer.findText(7, "Hidden body").text).toContain("Hidden body");
			details?.removeAttribute("open");
			expect(observer.findText(7, "Hidden body").text).toBe("");
		} finally {
			window.close();
		}
	});

	for (const [role, expectedRole] of [
		["textbox ", "textbox"],
		["textbox searchbox", "textbox"],
		["combobox listbox", "combobox"],
		["option ", "option"],
		[" \tTeXtBoX\n SeArChBoX ", "textbox"],
		["unknown textbox searchbox", "textbox"],
		["button textbox", "button"],
		["unknown button textbox", "button"],
		["searchbox textbox", "searchbox"],
		["listbox option", "listbox"],
		["slider spinbutton", "slider"],
		["spinbutton slider", "spinbutton"],
	] as const) {
		test(`ARIA token-list values stay private: ${JSON.stringify(role)}`, async () => {
			const sentinel = `verifier-aria-value-${crypto.randomUUID()}`;
			const { observer, window } = fixture(
				`<h1>Permitted title</h1><div role='${role}' aria-label='Private control'><span>${sentinel}</span><button type='button'>${sentinel}</button></div>`
			);
			expect(observer.observe(7).elements).toEqual([
				{ enabled: true, index: 1, name: "Permitted title", role: "heading" },
				{
					enabled: true,
					index: 2,
					name: "Private control",
					role: expectedRole,
				},
			]);
			await assertPrivateProviderPayload(observer, sentinel);
			window.close();
		});
	}

	test("first valid unsupported role wins while any editable token remains private", async () => {
		const sentinel = `verifier-aria-value-${crypto.randomUUID()}`;
		const { observer, window } = fixture(
			`<div role='unknown article textbox'>${sentinel}</div><button type='button' role='unknown none button'>Ordinary text</button>`
		);
		expect(observer.observe(7).elements).toEqual([]);
		await assertPrivateProviderPayload(observer, sentinel);
		window.close();
	});

	test("content-visibility hidden text and label references are excluded without native visibility support", async () => {
		const sentinel = `verifier-hidden-css-${crypto.randomUUID()}`;
		const { observer, document, window } = fixture(
			`<h1>Permitted content</h1><div id='hidden-prose' style='content-visibility:hidden;width:600px;height:60px'>${sentinel}<span>${sentinel}</span><button type='button'>${sentinel}</button></div><button type='button' aria-labelledby='hidden-prose'>Permitted button</button>`
		);
		Object.defineProperty(window.Element.prototype, "checkVisibility", {
			configurable: true,
			value: undefined,
		});
		expect(
			document.getElementById("hidden-prose")?.getClientRects().length
		).toBe(1);
		expect(observer.observe(7).elements.map((element) => element.name)).toEqual(
			["Permitted content", "Permitted button"]
		);
		await assertPrivateProviderPayload(observer, sentinel);
		window.close();
	});

	test("browser-reported invisible content is excluded with the required checkVisibility options", async () => {
		const sentinel = `verifier-browser-invisible-${crypto.randomUUID()}`;
		const { observer, document, window } = fixture(
			`<h1>Permitted content</h1><div id='skipped'>${sentinel}<button type='button'>${sentinel}</button></div>`
		);
		let visibilityChecks = 0;
		for (const element of document.querySelectorAll(
			"#skipped, #skipped button"
		)) {
			Object.defineProperty(element, "checkVisibility", {
				value: (options: unknown) => {
					visibilityChecks += 1;
					expect(options).toEqual({
						contentVisibilityAuto: true,
						opacityProperty: false,
						visibilityProperty: true,
					});
					return false;
				},
			});
		}
		await assertPrivateProviderPayload(observer, sentinel);
		expect(visibilityChecks).toBeGreaterThan(0);
		window.close();
	});

	for (const length of [19_999, 20_000, 20_001, 50_000]) {
		test(`text boundary: ${length} rendered characters`, () => {
			const { observer } = fixture(`<p>${"x".repeat(length)}</p>`);
			const snapshot = observer.observe(7);
			expect(snapshot.text.length).toBe(Math.min(length, 20_000));
			expect(snapshot.truncated).toBe(length > 20_000);
			assertBounded(snapshot);
		});
	}

	for (const count of [299, 300, 301, 600]) {
		test(`descriptor boundary: ${count} enabled controls`, () => {
			const { observer } = fixture(
				Array.from(
					{ length: count },
					(_, index) =>
						`<button id="b-${index}" type="button">Control ${index}</button>`
				).join("")
			);
			const snapshot = observer.observe(7);
			expect(snapshot.elements.length).toBe(Math.min(count, 300));
			expect(snapshot.truncated).toBe(count > 300);
			expect(
				observer.resolveElement(
					snapshot.snapshotId,
					snapshot.documentToken,
					301
				)
			).toBeNull();
			assertBounded(snapshot);
		});
	}

	test("both caps mark truncation and long descriptor names remain protocol-valid", () => {
		const { observer } = fixture(
			`<p>${"x".repeat(21_000)}</p>${"<button type='button'>Control</button>".repeat(301)}<button type='button'>${"n".repeat(2500)}</button>`
		);
		const initial = observer.observe(7);
		expect(initial.truncated).toBe(true);
		assertBounded(initial);
		const targeted = observer.observe(7, "n".repeat(100));
		expect(targeted.elements[0]?.name.length).toBe(2000);
		expect(targeted.truncated).toBe(true);
		assertBounded(targeted);
	});

	test("query retrieves text and an actionable control beyond both initial caps with fresh indexes", () => {
		const { observer, document } = fixture(
			`<p>${"early ".repeat(5000)}</p>${"<button type='button'>Earlier control</button>".repeat(350)}<p>Relevant passage: <strong>published work</strong> with live evidence. <a id='late' href='/reference'>Published work reference</a></p>`
		);
		const first = observer.observe(7);
		expect(first.text).not.toContain("Relevant passage");
		expect(
			first.elements.some((element) => element.name.includes("Published work"))
		).toBe(false);
		const targeted = observer.observe(7, "  published   work  ");
		expect(targeted.text).toContain("Relevant passage");
		expect(targeted.text).toContain("published work");
		expect(targeted.elements).toHaveLength(1);
		expect(targeted.elements[0]?.index).toBe(1);
		expect(targeted.snapshotId).not.toBe(first.snapshotId);
		expect(targeted.documentToken).toBe(first.documentToken);
		expect(targeted.truncated).toBe(true);
		expect(
			observer.resolveElement(first.snapshotId, first.documentToken, 1)
		).toBeNull();
		expect(
			observer.resolveElement(targeted.snapshotId, targeted.documentToken, 1)
		).toBe(document.getElementById("late"));
		assertBounded(targeted);
	});

	test("targeted search finds a match beyond 20k inside one large rendered text node", () => {
		const { observer } = fixture(
			`<p>${"x".repeat(25_000)} late needle evidence ${"y".repeat(25_000)}</p>`
		);
		expect(observer.observe(7).text).not.toContain("late needle evidence");
		const snapshot = observer.observe(7, "late needle");
		expect(snapshot.text).toContain("late needle evidence");
		expect(snapshot.truncated).toBe(true);
		assertBounded(snapshot);
	});

	test("targeted text search crosses inline nodes and handles many matches within the text cap", () => {
		const { observer } = fixture(
			`<p>Across <strong>inline</strong> nodes</p>${Array.from({ length: 150 }, () => `<p>${"x".repeat(300)} needle ${"y".repeat(300)}</p>`).join("")}`
		);
		expect(observer.observe(7, "across inline nodes").text).toContain(
			"Across inline nodes"
		);
		const many = observer.observe(7, "needle");
		expect(many.text).toContain("needle");
		expect(many.truncated).toBe(true);
		assertBounded(many);
	});

	test("no match returns no fabricated indexes; queries validate before replacing the current map", () => {
		const { observer } = fixture(
			"<button type='button'>Current target</button>"
		);
		const first = observer.observe(7);
		for (const query of ["", "  ", "x".repeat(2001)]) {
			expect(() => observer.observe(7, query)).toThrow("query");
		}
		expect(
			observer.resolveElement(first.snapshotId, first.documentToken, 1)
		).not.toBeNull();
		const absent = observer.observe(7, "does not exist");
		expect(absent.text).toBe("");
		expect(absent.elements).toEqual([]);
		expect(absent.truncated).toBe(true);
		expect(
			observer.resolveElement(first.snapshotId, first.documentToken, 1)
		).toBeNull();
	});

	test("serialized turn and actual provider body exclude randomized secrets without browser storage/cookie reads", async () => {
		const secret = (kind: string) => `seeded-${kind}-${crypto.randomUUID()}`;
		const secrets = Object.fromEntries(
			[
				"cookie",
				"local",
				"session",
				"hidden",
				"password",
				"input",
				"textarea",
				"select",
				"editable",
				"aria",
			].map((kind) => [kind, secret(kind)])
		);
		const { observer, document, window } = fixture(
			`<h1>Permitted page</h1><p>Rendered evidence</p><div hidden>${secrets.hidden}</div><div style='display:none'>${secrets.hidden}</div><input type='hidden' value='${secrets.hidden}'><input id='password' type='password' value='${secrets.password}'><label for='name'>Customer name</label><input id='name' value='${secrets.input}'><textarea aria-label='Notes'>${secrets.textarea}</textarea><select aria-label='Choice'><option selected value='${secrets.select}'>${secrets.select}</option></select><div contenteditable='true' aria-label='Editable note'>${secrets.editable}</div><div role='textbox' aria-label='Custom note'>${secrets.aria}</div><span hidden id='hidden-label'>${secrets.hidden}</span><button type='button' aria-labelledby='hidden-label'>Permitted button</button>`
		);
		window.document.cookie = `fixture=${secrets.cookie}`;
		window.localStorage.setItem("fixture", secrets.local ?? "");
		window.sessionStorage.setItem("fixture", secrets.session ?? "");
		let browserSecretReads = 0;
		const forbiddenRead = () => {
			browserSecretReads += 1;
			throw new Error("Observer must not read browser secrets");
		};
		Object.defineProperty(document, "cookie", { get: forbiddenRead });
		Object.defineProperty(window, "localStorage", { get: forbiddenRead });
		Object.defineProperty(window, "sessionStorage", { get: forbiddenRead });
		const password = document.getElementById("password");
		if (password) {
			Object.defineProperty(password, "value", { get: forbiddenRead });
		}
		let existingValueReads = 0;
		const nameInput = document.getElementById("name");
		if (nameInput) {
			Object.defineProperty(nameInput, "value", {
				get: () => {
					existingValueReads += 1;
					return secrets.input;
				},
			});
		}
		const snapshot = observer.observe(7);
		expect(existingValueReads).toBe(0);
		assertBounded(snapshot);
		expect(snapshot.text).toContain("Rendered evidence");
		expect(
			snapshot.elements.some((element) => element.inputType === "password")
		).toBe(false);
		const target = snapshot.elements.find(
			(element) =>
				element.name === "Customer name" && element.role === "textbox"
		);
		expect(target).toBeDefined();
		const check = observer.checkValue(
			snapshot.snapshotId,
			snapshot.documentToken,
			target?.index ?? 0,
			secrets.input ?? ""
		);
		expect(check).toEqual({ matches: true, status: "checked" });
		expect(
			observer.checkValue(
				snapshot.snapshotId,
				snapshot.documentToken,
				target?.index ?? 0,
				"different dummy value"
			)
		).toEqual({ matches: false, status: "checked" });
		const request = turnRequestSchema.parse({
			goal: "Read permitted page evidence",
			messages: [
				{
					role: "assistant",
					text: "Check current field locally",
					toolCall: { args: { tabId: 7 }, id: "check-1", name: "observe" },
				},
				{ result: JSON.stringify(check), role: "tool", toolCallId: "check-1" },
			],
			snapshot,
		});
		let providerBody = "";
		const transport = ((_url, options) => {
			providerBody = String(options?.body);
			return Promise.resolve(
				Response.json({
					choices: [
						{
							finish_reason: "stop",
							message: {
								content: "Observed permitted evidence",
								role: "assistant",
							},
						},
					],
				})
			);
		}) as typeof fetch;
		const adapter = createOpenRouterAdapter(
			{ OPENROUTER_API_KEY: "test-token-not-secret" },
			transport
		);
		expect(adapter).toBeDefined();
		await adapter?.turn(request, new AbortController().signal);
		expect(providerBody).toContain("UNTRUSTED_PAGE_SNAPSHOT_JSON");
		expect(providerBody).toContain("Rendered evidence");
		expect(providerBody).toContain("matches");
		for (const sentinel of Object.values(secrets)) {
			expect(JSON.stringify(request)).not.toContain(sentinel);
			expect(providerBody).not.toContain(sentinel);
			expect(JSON.stringify(check)).not.toContain(sentinel);
			const query = observer.observe(7, sentinel);
			expect(query.text).toBe("");
			expect(query.elements).toEqual([]);
		}
		expect(existingValueReads).toBe(2);
		expect(browserSecretReads).toBe(0);
		if (process.env.SIDEKICK_PRIVACY_EVIDENCE === "1") {
			await write(
				new URL(
					"../../../../evidence/82/outbound-provider.json",
					import.meta.url
				),
				`${providerBody}\n`
			);
		}
		expect(
			observer.checkValue(
				snapshot.snapshotId,
				snapshot.documentToken,
				target?.index ?? 0,
				"dummy"
			)
		).toEqual({ matches: false, status: "unavailable" });
	});
});
