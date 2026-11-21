import { chromium } from "@playwright/test";

// Isolated module test: HTTPS is fulfilled in-process, not an application server
// or a signaling/WebRTC integration test. Honour the assigned origin/port.
const origin = `https://localhost:${process.env.PUBLIC_PORT ?? "4129"}`;
const entrypoint = new URL(
	"../../../apps/web/src/lib/crypto/handshake.ts",
	import.meta.url
).pathname;
const bundle = await Bun.build({
	entrypoints: [entrypoint],
	target: "browser",
});
if (!bundle.success || !bundle.outputs[0]) {
	throw new Error("Browser module build failed");
}
const moduleCode = await bundle.outputs[0].text();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
try {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const page = await context.newPage();
	await page.route(`${origin}/**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><html><title>Isolated handshake smoke</title></html>",
		})
	);
	await page.goto(origin);
	const checks = await page.evaluate(async (code) => {
		const { EphemeralHandshake } = await import(
			`data:text/javascript,${encodeURIComponent(code)}`
		);
		const creator = await EphemeralHandshake.create(
			"browser-test-room",
			"creator"
		);
		const joiner = await EphemeralHandshake.create(
			"browser-test-room",
			"joiner"
		);
		await Promise.all([
			creator.acceptPeer(joiner.getHello()),
			joiner.acceptPeer(creator.getHello()),
		]);
		const [cProof, jProof] = await Promise.all([
			creator.createConfirmation(),
			joiner.createConfirmation(),
		]);
		await Promise.all([
			creator.acceptConfirmation(jProof),
			joiner.acceptConfirmation(cProof),
		]);
		const cKeys = creator.getSessionKeys();
		const jKeys = joiner.getSessionKeys();
		const iv = new Uint8Array(12);
		const plaintext = new TextEncoder().encode("browser-smoke");
		const encrypted = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			cKeys.send,
			plaintext
		);
		const decrypted = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			jKeys.receive,
			encrypted
		);
		const fresh = await EphemeralHandshake.create(
			"browser-test-room",
			"creator"
		);
		const results = {
			secureContext: isSecureContext,
			mutualConfirmation:
				creator.state === "authenticated" && joiner.state === "authenticated",
			matchingFingerprint: creator.getFingerprint() === joiner.getFingerprint(),
			grouped128BitFingerprint: /^[0-9A-F]{4}( [0-9A-F]{4}){7}$/.test(
				creator.getFingerprint()
			),
			matchingTranscript:
				creator.getSessionMetadata().transcriptHash ===
				joiner.getSessionMetadata().transcriptHash,
			directionalDecrypt:
				new TextDecoder().decode(decrypted) === "browser-smoke",
			nonExtractableKeys: !cKeys.send.extractable && !jKeys.receive.extractable,
			freshPublicKey:
				fresh.getHello().publicKey !== creator.getHello().publicKey,
			freshNonce: fresh.getHello().nonce !== creator.getHello().nonce,
			noSerializedPrivateMaterial: JSON.stringify(creator) === "{}",
			noWebStorage: localStorage.length === 0 && sessionStorage.length === 0,
			noIndexedDB: (await indexedDB.databases()).length === 0,
			noServiceWorker:
				(await navigator.serviceWorker.getRegistrations()).length === 0,
		};
		creator.destroy();
		joiner.destroy();
		fresh.destroy();
		return {
			...results,
			teardown: creator.state === "destroyed" && joiner.state === "destroyed",
		};
	}, moduleCode);
	const storage = await context.storageState();
	const allChecks = {
		...checks,
		noCookiesOrPersistedOrigins:
			storage.cookies.length === 0 && storage.origins.length === 0,
	};
	for (const [name, passed] of Object.entries(allChecks)) {
		console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
	}
	if (Object.values(allChecks).some((passed) => !passed)) {
		throw new Error("Isolated browser handshake smoke failed");
	}
	console.log(
		`${Object.keys(allChecks).length} isolated Chromium checks passed; no keys or secrets logged.`
	);
	await context.close();
} finally {
	await browser.close();
}
