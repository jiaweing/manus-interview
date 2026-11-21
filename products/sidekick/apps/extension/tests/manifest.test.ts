import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "bun";
import { validateProxyUrl } from "../../../packages/config/src/proxy-url";
import { proxyUrl } from "../src/proxy";
import { contentScriptInjection } from "../utils/content-script";
import {
	optionalDemoOrigins,
	proxyHostPermission,
	requiredPermissions,
} from "../utils/manifest";

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(extensionDir, ".output/chrome-mv3");
const manifestPath = resolve(outputDir, "manifest.json");

const contentMatchesDeclaration = /\bmatches\s*:/;
const forbiddenWorkerWiring =
	/\b(fetch|setInterval|setTimeout|while)\s*\(|\b(agentLoop|OpenRouter)\b|\b(tabs|scripting|alarms|debugger|nativeMessaging|onMessage)\s*\./;
const nonWxtWorkerImport = /^import\s.*from\s+["'](?!wxt\/)/m;

interface Manifest {
	action: { default_title: string; default_popup?: string };
	background: { service_worker: string; page?: string; scripts?: string[] };
	content_scripts?: unknown[];
	host_permissions: string[];
	manifest_version: number;
	minimum_chrome_version: string;
	optional_host_permissions: string[];
	permissions: string[];
	side_panel: { default_path: string };
}

let manifest: Manifest;
beforeAll(() => {
	if (!existsSync(manifestPath)) {
		const build = spawnSync(["bun", "run", "build"], {
			cwd: extensionDir,
			stderr: "inherit",
			stdout: "inherit",
		});
		expect(build.exitCode).toBe(0);
	}
	manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
}, 60_000);

describe("production Sidekick manifest", () => {
	test("registers a resolvable MV3 side panel without a toolbar popup", () => {
		expect(manifest.manifest_version).toBe(3);
		expect(manifest.minimum_chrome_version).toBe("116");
		expect(manifest.side_panel.default_path).toBe("sidepanel.html");
		expect(
			existsSync(resolve(outputDir, manifest.side_panel.default_path))
		).toBe(true);
		expect(
			existsSync(resolve(extensionDir, "entrypoints/sidepanel/main.tsx"))
		).toBe(true);
		expect(manifest.action.default_title).toBe("Open Sidekick");
		expect(manifest.action.default_popup).toBeUndefined();
	});

	test("grants exactly the five browser capabilities, never debugger or native messaging", () => {
		expect([...manifest.permissions].sort()).toEqual(
			[...requiredPermissions].sort()
		);
		expect(manifest.permissions).not.toContain("debugger");
		expect(manifest.permissions).not.toContain("nativeMessaging");
	});

	test("requires only the configured proxy origin and leaves demo origins optional", () => {
		expect(manifest.host_permissions).toEqual([
			proxyHostPermission(proxyUrl, process.env.NODE_ENV === "production"),
		]);
		expect(manifest.optional_host_permissions).toEqual(optionalDemoOrigins);
		for (const origin of [
			...manifest.host_permissions,
			...manifest.optional_host_permissions,
		]) {
			expect(origin).not.toBe("<all_urls>");
			expect(origin).not.toContain("://*");
		}
		for (const origin of optionalDemoOrigins) {
			expect(manifest.host_permissions).not.toContain(origin);
		}
	});

	test("packages the content script but does not auto-inject it or grant matches", () => {
		expect(manifest.content_scripts ?? []).toEqual([]);
		const injection = contentScriptInjection(42);
		expect(injection.target).toEqual({ frameIds: [0], tabId: 42 });
		expect(injection.world).toBe("ISOLATED");
		expect(injection.files).toEqual(["content-scripts/content.js"]);
		for (const file of injection.files) {
			expect(existsSync(resolve(outputDir, file))).toBe(true);
		}
		const content = readFileSync(
			resolve(extensionDir, "entrypoints/content.ts"),
			"utf8"
		);
		expect(content).toContain('registration: "runtime"');
		expect(content).toContain('world: "ISOLATED"');
		expect(content).toContain("allFrames: false");
		expect(content).toContain("window.top !== window");
		expect(content).not.toMatch(contentMatchesDeclaration);
	});

	test("keeps the MV3 worker limited to toolbar/panel setup", () => {
		expect(manifest.background.service_worker).toBe("background.js");
		expect(
			existsSync(resolve(outputDir, manifest.background.service_worker))
		).toBe(true);
		expect(manifest.background.page).toBeUndefined();
		expect(manifest.background.scripts).toBeUndefined();
		const worker = readFileSync(
			resolve(extensionDir, "entrypoints/background.ts"),
			"utf8"
		);
		expect(worker).toContain(
			".setPanelBehavior({ openPanelOnActionClick: true })"
		);
		expect(worker).not.toMatch(forbiddenWorkerWiring);
		expect(worker).not.toMatch(nonWxtWorkerImport);
	});
});

describe("proxy origin configuration", () => {
	test("defaults to local development and normalizes an HTTPS origin", () => {
		expect(proxyHostPermission()).toBe("http://localhost:8787/*");
		expect(proxyHostPermission("https://proxy.example.com/")).toBe(
			"https://proxy.example.com/*"
		);
	});

	test("permits only loopback HTTP development URLs", () => {
		expect(proxyHostPermission("http://127.0.0.1:8787")).toBe(
			"http://127.0.0.1:8787/*"
		);
		expect(proxyHostPermission("http://[::1]:8787")).toBe(
			"http://[::1]:8787/*"
		);
		expect(() => proxyHostPermission("http://proxy.example.com")).toThrow();
		expect(() => proxyHostPermission("http://localhost.example.com")).toThrow();
	});

	test("rejects wildcard, credential-bearing, non-HTTP(S), and malformed URLs", () => {
		for (const url of [
			"https://*.example.com",
			"https://test-user:test-token-not-secret@proxy.example.com",
			"https://proxy.example.com/v1/agent/turn",
			"https://proxy.example.com/?token=test-token-not-secret",
			"https://proxy.example.com/#token",
			"file:///tmp/proxy",
			"javascript:alert(1)",
			"not-a-url",
		]) {
			expect(() => proxyHostPermission(url)).toThrow();
			expect(() => validateProxyUrl(url, false)).toThrow();
		}
	});

	test("uses the same public URL for the extension client and manifest", () => {
		expect(proxyUrl).toBe(
			validateProxyUrl(process.env.WXT_SIDEKICK_PROXY_URL, false)
		);
		expect(proxyHostPermission(proxyUrl)).toBe(`${proxyUrl}/*`);
	});

	test("production requires an explicit HTTPS origin, even for loopback", () => {
		for (const url of [
			undefined,
			"http://localhost:8787",
			"http://proxy.example.com",
		]) {
			expect(() => proxyHostPermission(url, true)).toThrow();
		}
		expect(proxyHostPermission("https://proxy.example.com", true)).toBe(
			"https://proxy.example.com/*"
		);
	});
});
