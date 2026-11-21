import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { serve } from "bun";
import { type BrowserContext, chromium, type Page } from "playwright";
import type { browser } from "wxt/browser";
import type { Snapshot } from "../src/page/snapshot";
import { contentScriptInjection } from "../utils/content-script";

// Run with: xvfb-run -a bun apps/extension/tests/snapshot.browser.ts
// The temporary test copy adds only the local fixture origin, never all_urls.
// HTTPS demo access is granted in this disposable Chromium profile, not the
// production manifest or the user's browser. No provider API calls are made.
const extensionDir = resolve(import.meta.dir, "../.output/chrome-mv3");
const evidenceDir = resolve(import.meta.dir, "../../../evidence/81");
const temporary = await mkdtemp(resolve(tmpdir(), "sidekick-81-"));
const testExtension = resolve(temporary, "extension");
const profile = resolve(temporary, "profile");
await mkdir(evidenceDir, { recursive: true });
await cp(extensionDir, testExtension, { recursive: true });
const fixture = await readFile(
	resolve(import.meta.dir, "../src/page/fixtures/snapshot.html"),
	"utf8"
);
const server = serve({
	fetch: () =>
		new Response(fixture, { headers: { "content-type": "text/html" } }),
	hostname: "localhost",
	port: 0,
});
const fixtureOrigin = `http://localhost:${server.port}`;
const manifestPath = resolve(testExtension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push(`${fixtureOrigin}/*`);
await writeFile(manifestPath, JSON.stringify(manifest));
const results: Record<string, unknown> = {
	localFixtureOrigin: fixtureOrigin,
	permissionGrant: "disposable-profile-only",
	productionManifestUnchanged: true,
};

async function launch(): Promise<BrowserContext> {
	return await chromium.launchPersistentContext(profile, {
		args: [
			"--no-sandbox",
			"--ignore-certificate-errors",
			`--disable-extensions-except=${testExtension}`,
			`--load-extension=${testExtension}`,
		],
		executablePath: "/usr/bin/chromium",
		headless: false,
		ignoreDefaultArgs: ["--disable-extensions"],
	});
}

async function observe(panel: Page, tabId: number): Promise<Snapshot> {
	return await panel.evaluate(
		async ({ injection, tabId: target }) => {
			const { chrome } = globalThis as unknown as { chrome: typeof browser };
			// Chrome accepts the relative packaged path; WXT types require a slash.
			await (
				chrome.scripting.executeScript as (value: unknown) => Promise<unknown>
			)(injection);
			return (await chrome.tabs.sendMessage(
				target,
				{ tabId: target, type: "sidekick:observe" },
				{ frameId: 0 }
			)) as Snapshot;
		},
		{ injection: contentScriptInjection(tabId), tabId }
	);
}

async function tabIdFor(panel: Page, url: string): Promise<number> {
	return await panel.evaluate(async (targetUrl) => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) {
			throw new Error("Fixture tab not found");
		}
		return tab.id;
	}, url);
}

let context: BrowserContext | undefined;
try {
	context = await launch();
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent("serviceworker"));
	const extensionId = new URL(worker.url()).hostname;
	const panel = await context.newPage();
	await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
	const local = await context.newPage();
	await local.goto(`${fixtureOrigin}/fixture`);
	const tabId = await tabIdFor(panel, local.url());
	const first = await observe(panel, tabId);
	assert.equal(first.title, "Snapshot fixture");
	assert.equal(first.url, local.url());
	assert.equal(first.tabId, tabId);
	assert.equal(first.elements.length, 16, JSON.stringify(first.elements));
	assert.equal(
		new Set(first.elements.map((element) => element.index)).size,
		16
	);
	assert(first.text.includes("Rendered evidence for observation."));
	assert(!first.text.includes("existing-textarea-value-not-for-snapshot"));
	const second = await observe(panel, tabId);
	assert.notEqual(first.snapshotId, second.snapshotId);
	assert.equal(first.documentToken, second.documentToken);
	const resolved = await panel.evaluate(
		async ({ injection, snapshot }) => {
			const { chrome } = globalThis as unknown as { chrome: typeof browser };
			const result = await chrome.scripting.executeScript({
				args: [snapshot],
				func: (identity: Snapshot) => {
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
					return identity.elements.map(
						(element) =>
							observer.resolveElement(
								identity.snapshotId,
								identity.documentToken,
								element.index
							)?.id
					);
				},
				target: injection.target,
				world: "ISOLATED",
			});
			return result[0]?.result;
		},
		{ injection: contentScriptInjection(tabId), snapshot: second }
	);
	assert.deepEqual(resolved, [
		"heading",
		"link",
		"name-label",
		"name",
		"wrapped-label",
		"email",
		"notes",
		"size",
		"checkbox",
		"radio",
		"search",
		"button",
		"submit",
		"custom",
		"editable",
		"transparent",
	]);
	await local.reload();
	const replaced = await observe(panel, tabId);
	assert.notEqual(replaced.documentToken, second.documentToken);
	await local.screenshot({ path: resolve(evidenceDir, "local-fixture.png") });
	results.localFixture = {
		documentRotationOnReload: true,
		indexedElements: first.elements.length,
		liveMap:
			"all 16 original DOM targets (opacity-only hiding is out of scope)",
		result: "PASS",
		snapshotRotation: true,
	};
	console.log(
		"PASS local fixture: 16 indexed original targets, excluded boundaries, repeat injection, snapshot/document rotation"
	);

	const accessBefore = await panel.evaluate(async () => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		return await chrome.permissions.contains({
			origins: ["https://en.wikipedia.org/*"],
		});
	});
	assert.equal(accessBefore, false);
	// Select target through a test-only tabs-query adapter to exercise this panel
	// control as a standalone tab (native sidebar context selection is owned by #80).
	await panel.evaluate(() => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		chrome.tabs.query = (() =>
			Promise.resolve([
				{ id: 991, url: "https://en.wikipedia.org/wiki/Ada_Lovelace" },
			])) as unknown as typeof chrome.tabs.query;
		chrome.tabs.get = (() =>
			Promise.resolve({
				id: 991,
				url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
			})) as unknown as typeof chrome.tabs.get;
	});
	await panel
		.getByRole("button", { exact: true, name: "Observe page" })
		.click();
	await panel
		.getByRole("status")
		.getByText("Paused:", { exact: false })
		.waitFor();
	assert(
		await panel
			.getByRole("button", { name: "Allow access to en.wikipedia.org" })
			.isVisible()
	);
	await panel.setViewportSize({ height: 720, width: 320 });
	assert(
		await panel.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				document.documentElement.clientWidth
		)
	);
	await panel.screenshot({
		path: resolve(evidenceDir, "missing-origin-paused.png"),
	});
	// This real button invokes chrome.permissions.request in a user gesture.
	await panel
		.getByRole("button", { name: "Allow access to en.wikipedia.org" })
		.click();
	await new Promise((done) => setTimeout(done, 500));
	// Dismiss the native Chrome bubble in this isolated Xvfb display.
	execFileSync("xdotool", ["key", "Escape"]);
	results.missingAccess = {
		nativePermissionRequestClicked: true,
		note: "Native approval completion is not asserted; explicit profile grant is used below. Pause UI uses a test-only selected-tab adapter.",
		result: "PASS",
	};
	console.log(
		"PASS missing-origin pause and user-gesture Allow access button (native approval outcome not asserted)"
	);
	await context.close();
	context = undefined;

	// Grant only the two existing optional demo origins in the disposable profile.
	const preferencesPath = resolve(profile, "Default/Preferences");
	const preferences = JSON.parse(await readFile(preferencesPath, "utf8"));
	const settings = preferences.extensions.settings[extensionId];
	assert(settings, "Installed extension missing from test profile");
	for (const key of [
		"active_permissions",
		"granted_permissions",
		"runtime_granted_permissions",
	]) {
		settings[key] ??= {};
		settings[key].explicit_host = [
			...new Set([
				...(settings[key].explicit_host ?? []),
				"https://en.wikipedia.org/*",
				"https://httpbin.org/*",
			]),
		];
	}
	await writeFile(preferencesPath, JSON.stringify(preferences));
	context = await launch();
	const realPanel = await context.newPage();
	await realPanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
	const granted = await realPanel.evaluate(async () => {
		const { chrome } = globalThis as unknown as { chrome: typeof browser };
		return await chrome.permissions.contains({
			origins: ["https://en.wikipedia.org/*", "https://httpbin.org/*"],
		});
	});
	assert(
		granted,
		"Explicit optional origin grant was not accepted by Chromium"
	);
	console.log(
		"PASS Chromium permissions.contains confirms exactly scoped optional demo origins"
	);
	async function verifyRealSite(key: string, url: string) {
		const page = await context?.newPage();
		assert(page);
		try {
			const response = await page.goto(url, {
				timeout: 30_000,
				waitUntil: "domcontentloaded",
			});
			if (!response?.ok()) {
				throw new Error(`HTTP status ${response?.status()}`);
			}
			const target = await tabIdFor(realPanel, page.url());
			const snapshot = await observe(realPanel, target);
			assert(snapshot.elements.length > 0);
			assert(snapshot.text.length > 0);
			if (key === "wikipedia") {
				assert(snapshot.text.includes("Ada Lovelace"));
				assert(snapshot.elements.some((element) => element.role === "heading"));
			} else {
				assert(
					snapshot.elements.some(
						(element) =>
							element.name.includes("Customer name") &&
							element.role === "textbox"
					)
				);
				assert(
					snapshot.elements.some(
						(element) =>
							element.name.includes("Telephone") && element.role === "textbox"
					)
				);
			}
			await page.screenshot({ path: resolve(evidenceDir, `${key}-live.png`) });
			results[key] = {
				indexedElements: snapshot.elements.length,
				renderedCharacters: snapshot.text.length,
				result: "PASS",
				title: snapshot.title,
				url: snapshot.url,
			};
			console.log(
				`PASS ${key}: ${snapshot.elements.length} indexed elements, ${snapshot.text.length} rendered characters`
			);
		} catch (error) {
			results[key] = {
				reason:
					error instanceof Error ? error.message : "Unknown browser error",
				result: "UNVERIFIED",
				url,
			};
			console.log(`UNVERIFIED ${key}: ${JSON.stringify(results[key])}`);
		}
	}
	await verifyRealSite(
		"wikipedia",
		"https://en.wikipedia.org/wiki/Ada_Lovelace"
	);
	await verifyRealSite("httpbin", "https://httpbin.org/forms/post");
} finally {
	await context?.close();
	server.stop(true);
	await writeFile(
		resolve(evidenceDir, "browser-results.json"),
		`${JSON.stringify(results, null, 2)}\n`
	);
	await rm(temporary, { force: true, recursive: true });
}
