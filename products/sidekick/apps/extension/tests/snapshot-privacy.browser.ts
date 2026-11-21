import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { serve } from "bun";
import { chromium } from "playwright";
import type { browser } from "wxt/browser";
import {
	snapshotSchema,
	turnRequestSchema,
} from "../../../packages/protocol/src";
import { createOpenRouterAdapter } from "../../server/src/agent/openrouter";
import type { Snapshot } from "../src/page/snapshot";
import { contentScriptInjection } from "../utils/content-script";

// xvfb-run -a bun apps/extension/tests/snapshot-privacy.browser.ts
// Only the disposable test extension/profile gains this local fixture origin.
const temporary = await mkdtemp(resolve(tmpdir(), "sidekick-82-"));
const extension = resolve(temporary, "extension");
const evidence = resolve(import.meta.dir, "../../../evidence/82");
await mkdir(evidence, { recursive: true });
await cp(resolve(import.meta.dir, "../.output/chrome-mv3"), extension, {
	recursive: true,
});
const secrets = Array.from(
	{ length: 7 },
	(_, index) => `seeded-browser-${index}-${crypto.randomUUID()}`
);
const fixture = `<html><head><title>Privacy browser fixture</title></head><body>
<p>${"Early rendered text ".repeat(2000)}</p>
${"<button type='button'>Earlier control</button>".repeat(350)}
<p>Late published work evidence. <a id='late' href='/reference'>Published work reference</a></p>
<div hidden>${secrets[0]}</div><input type='hidden' value='${secrets[0]}'>
<input type='password' value='${secrets[1]}'><input aria-label='Customer name' value='${secrets[2]}'>
<textarea aria-label='Notes'>${secrets[3]}</textarea><div contenteditable='true' aria-label='Editable note'>${secrets[4]}</div>
<script>document.cookie='fixture=${secrets[5]}'; localStorage.setItem('fixture','${secrets[6]}'); sessionStorage.setItem('fixture','${secrets[6]}');</script>
</body></html>`;
const privateRoles = [
	"textbox ",
	"textbox searchbox",
	"combobox listbox",
	"option ",
	" \tTeXtBoX\n SeArChBoX ",
	"unknown textbox",
	"button textbox",
	"unknown article textbox",
	"searchbox textbox",
	"listbox option",
	"slider spinbutton",
	"spinbutton slider",
];
const roleSecrets = privateRoles.map(
	() => `verifier-aria-value-${crypto.randomUUID()}`
);
const hiddenSecret = `verifier-hidden-css-${crypto.randomUUID()}`;
const autoSecret = `verifier-hidden-auto-${crypto.randomUUID()}`;
const privacyFixture = `<html><head><title>Independent privacy fixture</title></head><body>
<h1>Permitted content</h1>
${privateRoles.map((role, index) => `<div role='${role}' aria-label='Private control ${index}'><span>${roleSecrets[index]}</span><button type='button'>${roleSecrets[index]}</button></div>`).join("")}
<div id='hidden-prose' style='content-visibility:hidden;width:600px;height:60px'>${hiddenSecret}<span>${hiddenSecret}</span><button type='button'>${hiddenSecret}</button></div>
<button type='button' aria-labelledby='hidden-prose'>Permitted button</button><p>Permitted footer</p>
<div style='content-visibility:auto;contain-intrinsic-size:600px 60px;margin-top:20000px'><span id='auto-text'>${autoSecret}</span><button type='button'>${autoSecret}</button></div>
</body></html>`;
const server = serve({
	fetch: (request) =>
		new Response(
			new URL(request.url).pathname === "/privacy" ? privacyFixture : fixture,
			{ headers: { "content-type": "text/html" } }
		),
	hostname: "localhost",
	port: 0,
});
const url = `http://localhost:${server.port}/fixture`;
const manifestPath = resolve(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push(`http://localhost:${server.port}/*`);
await writeFile(manifestPath, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(
	resolve(temporary, "profile"),
	{
		args: [
			"--no-sandbox",
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
		],
		executablePath: "/usr/bin/chromium",
		headless: false,
		ignoreDefaultArgs: ["--disable-extensions"],
	}
);
try {
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent("serviceworker"));
	const extensionId = new URL(worker.url()).hostname;
	const panel = await context.newPage();
	await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
	const page = await context.newPage();
	await page.goto(url);
	const tabId = await panel.evaluate(async (target) => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		const tab = (await chrome.tabs.query({})).find(
			(candidate) => candidate.url === target
		);
		assertTab(tab?.id);
		function assertTab(id: number | undefined): asserts id is number {
			if (id === undefined) {
				throw new Error("Fixture tab not found");
			}
		}
		return tab.id;
	}, url);
	assert(tabId !== undefined);
	async function observe(query?: string): Promise<Snapshot> {
		return await panel.evaluate(
			async ({ injection, query: search, target }) => {
				const { chrome } = globalThis as unknown as { chrome: typeof browser };
				await (
					chrome.scripting.executeScript as (value: unknown) => Promise<unknown>
				)(injection);
				return (await chrome.tabs.sendMessage(
					target,
					{ query: search, tabId: target, type: "sidekick:observe" },
					{ frameId: 0 }
				)) as Snapshot;
			},
			{ injection: contentScriptInjection(tabId), query, target: tabId }
		);
	}
	const first = await observe();
	assert.equal(first.text.length, 20_000);
	assert.equal(first.elements.length, 300);
	assert.equal(first.truncated, true);
	assert(!first.text.includes("Late published work"));
	assert(snapshotSchema.safeParse(first).success);
	const targeted = await observe("published work");
	assert(targeted.text.includes("Late published work evidence"));
	assert.equal(targeted.elements.length, 1);
	assert.equal(targeted.elements[0]?.index, 1);
	assert.equal(targeted.elements[0]?.name, "Published work reference");
	assert.notEqual(targeted.snapshotId, first.snapshotId);
	assert.equal(targeted.documentToken, first.documentToken);
	assert(snapshotSchema.safeParse(targeted).success);
	const privateControls = await observe("note");
	for (const sentinel of secrets) {
		assert(
			!JSON.stringify([first, targeted, privateControls]).includes(sentinel)
		);
		// biome-ignore lint/performance/noAwaitInLoops: Each observation replaces this document's live index map; preserve browser turn order.
		const absent = await observe(sentinel);
		assert.equal(absent.text, "");
		assert.equal(absent.elements.length, 0);
	}
	// Exercise the observer's private target map in the isolated world. Only IDs
	// and boolean checks return; neither DOM targets nor current values leave it.
	const fresh = await observe("published work");
	const mapped = await panel.evaluate(
		async ({ injection, initial, current }) => {
			const { chrome } = globalThis as unknown as { chrome: typeof browser };
			const result = await chrome.scripting.executeScript({
				args: [initial, current],
				func: (old: Snapshot, latest: Snapshot) => {
					const observer = (
						globalThis as unknown as {
							__sidekickSnapshotObserver: {
								resolveElement: (
									snapshotId: string,
									token: string,
									index: number
								) => Element | null;
							};
						}
					).__sidekickSnapshotObserver;
					return {
						currentId: observer.resolveElement(
							latest.snapshotId,
							latest.documentToken,
							1
						)?.id,
						oldInvalid:
							observer.resolveElement(old.snapshotId, old.documentToken, 1) ===
							null,
					};
				},
				target: injection.target,
				world: "ISOLATED",
			});
			return result[0]?.result;
		},
		{ current: fresh, initial: first, injection: contentScriptInjection(tabId) }
	);
	assert.deepEqual(mapped, { currentId: "late", oldInvalid: true });
	await page.reload();
	assert.notEqual(
		(await observe("published work")).documentToken,
		fresh.documentToken
	);
	await page.goto(`http://localhost:${server.port}/privacy`);
	const hiddenLayout = await page
		.locator("#hidden-prose")
		.evaluate((element) => ({
			contentVisibility: getComputedStyle(element).contentVisibility,
			height: element.getBoundingClientRect().height,
			innerText: (element as HTMLElement).innerText,
			width: element.getBoundingClientRect().width,
		}));
	assert.deepEqual(hiddenLayout, {
		contentVisibility: "hidden",
		height: 60,
		innerText: "",
		width: 600,
	});
	const autoSkipped = await page.locator("#auto-text").evaluate(
		(element) =>
			!element.checkVisibility({
				contentVisibilityAuto: true,
				opacityProperty: false,
				visibilityProperty: true,
			})
	);
	assert.equal(autoSkipped, true);
	const privacySnapshot = await observe();
	assert(privacySnapshot.text.includes("Permitted footer"));
	assert(
		privacySnapshot.elements.some(
			(element) => element.name === "Permitted button"
		)
	);
	const request = turnRequestSchema.parse({
		goal: "Read permitted content",
		messages: [],
		snapshot: privacySnapshot,
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
	assert(providerBody.includes("UNTRUSTED_PAGE_SNAPSHOT_JSON"));
	const regressionSecrets = [...roleSecrets, hiddenSecret, autoSecret];
	for (const sentinel of regressionSecrets) {
		assert(!JSON.stringify(privacySnapshot).includes(sentinel));
		assert(!providerBody.includes(sentinel));
		// biome-ignore lint/performance/noAwaitInLoops: Each query must test the fresh live observer map in browser turn order.
		const targetedSecret = await observe(sentinel);
		assert.equal(targetedSecret.text, "");
		assert.equal(targetedSecret.elements.length, 0);
		assert(!JSON.stringify(targetedSecret).includes(sentinel));
	}
	const results = {
		ariaRoleRegressionCases: privateRoles,
		bounds: {
			controls: first.elements.length,
			textCharacters: first.text.length,
			truncated: first.truncated,
		},
		browser: "headed /usr/bin/chromium via xvfb-run",
		browserReportedAutoSkipped: autoSkipped,
		documentRotationOnReload: true,
		freshTargetId: "late",
		hiddenLayout,
		providerCalls: 0,
		providerSerializationChecked: true,
		result: "PASS",
		secretExclusions: secrets.length + regressionSecrets.length,
		targetedControls: targeted.elements.length,
	};
	await writeFile(
		resolve(evidence, "browser-results.json"),
		`${JSON.stringify(results, null, 2)}\n`
	);
	console.log(
		`PASS packaged Chromium observer: 20,000 characters / 300 controls, targeted late evidence + live index, ${results.secretExclusions} randomized secret exclusions, ARIA role tokens, CSS/native visibility, provider serialization, snapshot/document rotation`
	);
} finally {
	await context.close();
	server.stop(true);
	await rm(temporary, { force: true, recursive: true });
}
