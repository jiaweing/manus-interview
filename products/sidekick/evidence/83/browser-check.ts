import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "../../apps/extension/node_modules/playwright";
import type { Action } from "../../packages/protocol/src";
import type { Snapshot } from "../../apps/extension/src/page/snapshot";
import { contentScriptInjection } from "../../apps/extension/utils/content-script";

// xvfb-run -a bun evidence/83/browser-check.ts
// Only the disposable extension copy grants the local fixture origin.
// Production tools are owned by #84–#87; this test's executor only clicks fixture buttons.
const product = resolve(import.meta.dir, "../..");
const temporary = await mkdtemp(resolve(tmpdir(), "sidekick-83-"));
const extension = resolve(temporary, "extension");
await cp(resolve(product, "apps/extension/.output/chrome-mv3"), extension, { recursive: true });
const html = `<!doctype html><title>Sidekick #83 dispatch fixture</title><h1>Recorded-target dispatch</h1><p>Local dummy buttons; no outbound submission.</p><div id="controls"><button id="first" type="button">First</button><button id="second" type="button">Second</button></div><p>Mutation count: <output id="count">0</output></p><script>window.mutations=0;for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{document.querySelector('#count').textContent=String(++window.mutations)});</script>`;
const server = Bun.serve({ hostname: "localhost", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
const url = `http://localhost:${server.port}/fixture`;
const manifestPath = resolve(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push(`http://localhost:${server.port}/*`);
await writeFile(manifestPath, JSON.stringify(manifest));
let context: BrowserContext | undefined;
const results: Record<string, unknown> = { productionManifestUnchanged: true, providerCalls: 0, trustedFixtureExecutorOnly: true };

async function launch(profile: string) {
	context = await chromium.launchPersistentContext(resolve(temporary, profile), { executablePath: "/usr/bin/chromium", headless: false, ignoreDefaultArgs: ["--disable-extensions"], args: ["--no-sandbox", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
	const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
	const panel = await context.newPage();
	await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
	const page = await context.newPage();
	await page.goto(url);
	const tabId = await panel.evaluate(async (url) => {
		const tabs = await (globalThis as any).chrome.tabs.query({});
		return tabs.find((tab: any) => tab.url === url).id as number;
	}, url);
	return { panel, page, tabId };
}

async function message(panel: Page, tabId: number, message: unknown) {
	return await panel.evaluate(async ({ tabId, message, injection }) => {
		await (globalThis as any).chrome.scripting.executeScript(injection);
		return await (globalThis as any).chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
	}, { tabId, message, injection: contentScriptInjection(tabId) });
}

async function prepare(panel: Page, tabId: number, actionId = "action-1") {
	const snapshot = await message(panel, tabId, { type: "sidekick:observe", tabId }) as Snapshot;
	const binding = { runId: "browser-run", tabId, snapshotId: snapshot.snapshotId, documentToken: snapshot.documentToken };
	assert.deepEqual(await message(panel, tabId, { type: "sidekick:bind-run", binding }), { status: "ready" });
	const index = snapshot.elements.find((element) => element.name === "First")?.index;
	assert(index);
	const action: Action = { ...binding, actionId, preview: "Click fixture First", tool: "click", args: { index } };
	return action;
}

try {
	const original = await launch("production-profile");
	const action = await prepare(original.panel, original.tabId);
	assert.deepEqual(await message(original.panel, original.tabId, { type: "sidekick:dispatch", action }), { status: "unsupported-tool", reobserveRequired: false });
	await original.page.locator("#first").evaluate((element) => element.remove());
	assert.deepEqual(await message(original.panel, original.tabId, { type: "sidekick:dispatch", action }), { status: "stale-target", reason: "target-changed", reobserveRequired: true });
	assert.equal(await original.page.locator("#count").textContent(), "0");
	assert.equal(await original.page.evaluate(() => typeof (globalThis as any).__sidekickPageDispatcher), "undefined");
	results.productionPackagedScript = "PASS: installed isolated dispatcher rejects removed target, no executor added before tool issues";
	console.log("PASS production packaged script: isolated listener, valid envelope routing, removed-target rejection, zero mutations");
	await context!.close();
	context = undefined;

	// Build the SAME dispatcher/observer modules with a fixture-only trusted executor.
	// No model code or executeScript.func enters the browser dispatch route.
	const entry = resolve(temporary, "fixture-entry.ts");
	await writeFile(entry, `import { installSnapshotObserver } from ${JSON.stringify(resolve(product, "apps/extension/src/page/observer.ts"))};\nif(window.top===window)installSnapshotObserver((action,target)=>{if(action.tool!=="click"||!target)throw new Error("fixture only");target.click();});\n`);
	const built = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: true });
	assert(built.success, JSON.stringify(built.logs));
	await writeFile(resolve(extension, "content-scripts/content.js"), await built.outputs[0].text());
	const f = await launch("trusted-executor-profile");
	for (const scenario of ["removed", "replaced", "reordered", "hidden", "disabled", "snapshot", "malformed", "unknown-index"] as const) {
		await f.page.reload();
		const queued = await prepare(f.panel, f.tabId, `action-${scenario}`);
		if (scenario === "removed") await f.page.locator("#first").evaluate((element) => element.remove());
		if (scenario === "replaced") await f.page.locator("#first").evaluate((element) => element.replaceWith(element.cloneNode(true)));
		if (scenario === "reordered") await f.page.locator("#second").evaluate((element) => element.parentElement!.prepend(element));
		if (scenario === "hidden") await f.page.locator("#first").evaluate((element) => element.setAttribute("hidden", ""));
		if (scenario === "disabled") await f.page.locator("#first").evaluate((element) => element.setAttribute("disabled", ""));
		if (scenario === "snapshot") await message(f.panel, f.tabId, { type: "sidekick:observe", tabId: f.tabId });
		const input = scenario === "malformed" ? { ...queued, func: "alert(1)" } : scenario === "unknown-index" ? { ...queued, args: { index: 999 } } : queued;
		const result = await message(f.panel, f.tabId, { type: "sidekick:dispatch", action: input });
		assert.equal(result.status, scenario === "malformed" ? "invalid-action" : "stale-target");
		assert.equal(result.reobserveRequired, true);
		assert.equal(await f.page.locator("#count").textContent(), "0");
		results[scenario] = { status: result.status, mutations: 0, reobserveRequired: true };
		console.log(`PASS real Chromium ${scenario}: zero mutations; explicit re-observation`);
	}
	await f.page.reload();
	const beforeReload = await prepare(f.panel, f.tabId, "before-navigation");
	await f.page.reload();
	const navigated = await message(f.panel, f.tabId, { type: "sidekick:dispatch", action: beforeReload });
	assert.equal(navigated.status, "stale-target");
	assert.equal(navigated.reobserveRequired, true);
	assert.equal(await f.page.locator("#count").textContent(), "0");
	results.navigation = { status: navigated.status, mutations: 0, reobserveRequired: true };
	console.log("PASS real Chromium document navigation: zero mutations; explicit re-observation");

	const matching = await prepare(f.panel, f.tabId, "matching-action");
	const once = await message(f.panel, f.tabId, { type: "sidekick:dispatch", action: matching });
	assert.equal(once.status, "dispatched");
	assert.equal(await f.page.locator("#count").textContent(), "1");
	const duplicate = await message(f.panel, f.tabId, { type: "sidekick:dispatch", action: matching });
	assert.equal(duplicate.reason, "duplicate-action");
	assert.equal(await f.page.locator("#count").textContent(), "1");
	assert.equal(await f.page.evaluate(() => typeof (globalThis as any).__sidekickPageDispatcher), "undefined");
	await f.page.screenshot({ path: resolve(import.meta.dir, "matching-once.png") });
	results.matching = { status: once.status, mutations: 1, duplicateRejected: true, isolatedFromPageWorld: true };
	console.log("PASS real Chromium matching target: exactly one mutation through fixed packaged isolated file; duplicate rejected");
} finally {
	await context?.close();
	server.stop(true);
	await writeFile(resolve(import.meta.dir, "browser-results.json"), `${JSON.stringify(results, null, 2)}\n`);
	await rm(temporary, { force: true, recursive: true });
}
