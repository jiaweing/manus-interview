import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { serve } from "bun";
import { chromium } from "playwright";
import type { browser } from "wxt/browser";
import { snapshotSchema } from "../../../packages/protocol/src";
import {
	exposedCases,
	exposedFixture,
	exposedPositiveFixture,
	exposureCases,
	exposureFixture,
} from "../src/page/fixtures/exposure-matrix";
import type { Snapshot, SnapshotObserver } from "../src/page/snapshot";
import { contentScriptInjection } from "../utils/content-script";
import { serializedPrivacyPayload } from "./privacy-provider";

// WXT_SIDEKICK_PROXY_URL=https://example.com bun run build:extension
// xvfb-run -a bun apps/extension/tests/exposure.browser.ts
const temporary = await mkdtemp(resolve(tmpdir(), "sidekick-82-exposure-"));
const extension = resolve(temporary, "extension");
const evidence = resolve(import.meta.dir, "../../../evidence/82");
await mkdir(evidence, { recursive: true });
await cp(resolve(import.meta.dir, "../.output/chrome-mv3"), extension, {
	recursive: true,
});
const cases = exposureCases.map((entry) => ({
	entry,
	sentinel: `exposure-${crypto.randomUUID()}`,
}));
const positiveCases = exposedCases.map((entry) => ({
	entry,
	marker: `visible-${crypto.randomUUID()}`,
}));
const server = serve({
	fetch: (request) => {
		const path = new URL(request.url).pathname;
		const current = cases[Number(path.slice(1))];
		const visible = positiveCases[Number(path.slice("/visible/".length))];
		let body = "";
		if (path === "/positive") {
			body = exposedPositiveFixture;
		} else if (path.startsWith("/visible/") && visible) {
			body = exposedFixture(visible.entry, visible.marker);
		} else if (current) {
			body = exposureFixture(current.entry, current.sentinel);
		}
		return new Response(
			`<html><head><title>Exposure matrix</title></head><body>${body}</body></html>`,
			{ headers: { "content-type": "text/html" } }
		);
	},
	hostname: "localhost",
	port: 0,
});
const origin = `http://localhost:${server.port}`;
const manifestPath = resolve(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push(`${origin}/*`);
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
	const panel = await context.newPage();
	await panel.goto(
		`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`
	);
	const page = await context.newPage();
	await page.goto(`${origin}/positive`);
	const tabId = await panel.evaluate(async (url) => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		return (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id;
	}, page.url());
	assert(tabId !== undefined);
	async function observe(query?: string, find = false): Promise<Snapshot> {
		return await panel.evaluate(
			async ({ injection, target, search, findText }) => {
				const { chrome } = globalThis as unknown as { chrome: typeof browser };
				await (
					chrome.scripting.executeScript as (value: unknown) => Promise<unknown>
				)(injection);
				if (findText) {
					const results = await chrome.scripting.executeScript({
						args: [target, search ?? ""],
						func: (id: number, queryText: string) =>
							(
								globalThis as unknown as {
									__sidekickSnapshotObserver: SnapshotObserver;
								}
							).__sidekickSnapshotObserver.findText(id, queryText),
						target: injection.target,
						world: "ISOLATED",
					});
					return results[0]?.result as Snapshot;
				}
				return (await chrome.tabs.sendMessage(
					target,
					{ query: search, tabId: target, type: "sidekick:observe" },
					{ frameId: 0 }
				)) as Snapshot;
			},
			{
				findText: find,
				injection: contentScriptInjection(tabId as number),
				search: query,
				target: tabId as number,
			}
		);
	}
	const positive = await observe();
	for (const text of [
		"Visible closed summary",
		"Visible summary control",
		"Visible open body",
		"Visible open control",
		"Visible dialog body",
		"Visible dialog control",
		"Visible revealed content",
		"Visible revealed control",
		"Visible false aria-hidden",
		"Visible description",
	]) {
		assert(positive.text.includes(text), `Positive control missing: ${text}`);
	}
	assert(!positive.text.includes("Hidden body"));
	assert(
		positive.elements.some((entry) => entry.name === "Visible description")
	);
	await page.screenshot({ path: resolve(evidence, "exposure-positive.png") });
	await page
		.locator("details")
		.first()
		.evaluate((element) => element.setAttribute("open", ""));
	assert((await observe("Hidden body", true)).text.includes("Hidden body"));
	await page
		.locator("details")
		.first()
		.evaluate((element) => element.removeAttribute("open"));
	assert.equal((await observe("Hidden body", true)).text, "");
	const positiveResults: {
		kind: string;
		result: string;
		liveTargetId: string;
	}[] = [];
	for (const [index, { entry, marker }] of positiveCases.entries()) {
		// biome-ignore lint/performance/noAwaitInLoops: Each case replaces this live tab's document/index state.
		await page.goto(`${origin}/visible/${index}`);
		const initial = await observe();
		assert.equal(initial.text.length, 20_000, entry.kind);
		assert(initial.truncated, entry.kind);
		assert(!initial.text.includes(marker), entry.kind);
		const targeted = await observe(marker);
		const found = await observe(marker, true);
		for (const result of [targeted, found]) {
			assert(snapshotSchema.safeParse(result).success, entry.kind);
			assert(result.text.includes(`${marker} direct evidence`), entry.kind);
			assert(result.text.includes(`${marker} nested evidence`), entry.kind);
			assert(
				result.elements.some((element) => element.name === `${marker} label`),
				entry.kind
			);
			assert(
				result.elements.some(
					(element) => element.name === `${marker} description`
				),
				entry.kind
			);
			assert.equal(result.documentToken, initial.documentToken, entry.kind);
			assert.notEqual(result.snapshotId, initial.snapshotId, entry.kind);
		}
		const link = found.elements.find((element) => element.role === "link");
		assert(link, entry.kind);
		const mapped: unknown = await panel.evaluate(
			async ({ target, current, old, index: targetIndex }) => {
				const { chrome } = globalThis as unknown as { chrome: typeof browser };
				const results = await chrome.scripting.executeScript({
					args: [current, old, targetIndex],
					func: (fresh: Snapshot, previous: Snapshot, elementIndex: number) => {
						const observer = (
							globalThis as unknown as {
								__sidekickSnapshotObserver: SnapshotObserver;
							}
						).__sidekickSnapshotObserver;
						return {
							id: observer.resolveElement(
								fresh.snapshotId,
								fresh.documentToken,
								elementIndex
							)?.id,
							oldInvalid:
								observer.resolveElement(
									previous.snapshotId,
									previous.documentToken,
									elementIndex
								) === null,
						};
					},
					target: { frameIds: [0], tabId: target },
					world: "ISOLATED",
				});
				return results[0]?.result;
			},
			{ current: found, index: link.index, old: initial, target: tabId }
		);
		assert.deepEqual(mapped, { id: "late", oldInvalid: true }, entry.kind);
		const body = await serializedPrivacyPayload(initial, [targeted, found]);
		assert(body.includes(`${marker} direct evidence`), entry.kind);
		if (entry.kind === "display:contents wrapper") {
			await page.locator("#late").scrollIntoViewIfNeeded();
			await page.screenshot({
				path: resolve(evidence, "exposure-display-contents.png"),
			});
			assert(
				(await observe(marker)).text.includes(`${marker} direct evidence`)
			);
		}
		positiveResults.push({
			kind: entry.kind,
			liveTargetId: "late",
			result: "PASS",
		});
		console.log(
			`PASS visible ${index + 1}/${positiveCases.length}: ${entry.kind}`
		);
	}
	const results: {
		kind: string;
		result: string;
		snapshotLeak: boolean;
		targetedLeak: boolean;
		findTextLeak: boolean;
		nearbyLeak: boolean;
		providerLeak: boolean;
		nativeSkipped?: { boxVisible: boolean; contentsEmpty: boolean }[];
	}[] = [];
	for (const [index, { entry, sentinel }] of cases.entries()) {
		// biome-ignore lint/performance/noAwaitInLoops: Each case navigates the same live tab and replaces its document/index state.
		await page.goto(`${origin}/${index}`);
		const nativeSkipped = entry.nativeSkipped
			? await page.evaluate(() =>
					Array.from(document.querySelectorAll("[data-auto-skipped]")).map(
						(element) => ({
							boxVisible: element.checkVisibility({
								contentVisibilityAuto: true,
								visibilityProperty: true,
							}),
							contentsEmpty: (element as HTMLElement).innerText === "",
						})
					)
				)
			: undefined;
		if (nativeSkipped) {
			assert(nativeSkipped.length > 0, entry.kind);
			assert(
				nativeSkipped.every((state) => state.boxVisible && state.contentsEmpty),
				entry.kind
			);
		}
		const snapshot = await observe();
		const targeted = await observe(sentinel);
		const found = await observe(sentinel, true);
		const nearby = await observe("Permitted");
		const body = await serializedPrivacyPayload(snapshot, [
			targeted,
			found,
			nearby,
		]);
		assert(body.includes("UNTRUSTED_PAGE_SNAPSHOT_JSON"));
		assert(snapshot.text.includes("Permitted heading"));
		for (const result of [snapshot, targeted, found, nearby]) {
			assert(snapshotSchema.safeParse(result).success, entry.kind);
			assert(
				!JSON.stringify(result).includes(sentinel),
				`${entry.kind}: snapshot/tool leak`
			);
		}
		for (const result of [targeted, found]) {
			assert.equal(result.text, "", entry.kind);
			assert.deepEqual(result.elements, [], entry.kind);
		}
		assert(!body.includes(sentinel), `${entry.kind}: outbound provider leak`);
		results.push({
			findTextLeak: false,
			kind: entry.kind,
			nativeSkipped,
			nearbyLeak: false,
			providerLeak: false,
			result: "PASS",
			snapshotLeak: false,
			targetedLeak: false,
		});
		console.log(`PASS exposure ${index + 1}/${cases.length}: ${entry.kind}`);
		if (entry.kind === "closed details direct text and descendants") {
			await page.screenshot({
				path: resolve(evidence, "exposure-collapsed.png"),
			});
		}
	}
	await writeFile(
		resolve(evidence, "exposure-results.json"),
		`${JSON.stringify({ browser: "headed /usr/bin/chromium under xvfb-run", cases: cases.length, fuzzCases: 64, positiveControls: true, positiveResults, providerNetworkCalls: 0, providerSerializationChecked: true, result: "PASS", results }, null, 2)}\n`
	);
	console.log(
		`PASS ${cases.length} packaged Chromium exclusion cases including 64 seeded fuzz variants, ${positiveCases.length} long-page positive cases, initial/targeted/findText/nearby observations and adapter-serialized provider bodies`
	);
} finally {
	await context.close();
	server.stop(true);
	await rm(temporary, { force: true, recursive: true });
}
