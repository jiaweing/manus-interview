/** biome-ignore-all lint/performance/noAwaitInLoops: Ordered encrypted frames are intentionally received sequentially. */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);
let bundleDirectory = "";
let bundle = "";

test.beforeAll(async () => {
	bundleDirectory = await mkdtemp(resolve(tmpdir(), "glassroom-envelope-130-"));
	const entry = resolve(bundleDirectory, "entry.ts");
	const output = resolve(bundleDirectory, "codec.js");
	// Test-only bundle of the actual source, served only by the runner's route.
	// No endpoint, browser global, test controls, or bundle ships with the app.
	await writeFile(
		entry,
		[
			`export * from ${JSON.stringify(resolve("apps/web/src/lib/crypto/data-envelope.ts"))};`,
			`export * from ${JSON.stringify(resolve("apps/web/src/lib/crypto/handshake.ts"))};`,
			"",
		].join("\n")
	);
	await run("bun", [
		"build",
		entry,
		"--target=browser",
		"--format=esm",
		"--outfile",
		output,
	]);
	bundle = await readFile(output, "utf8");
});

test.afterAll(async () => {
	if (bundleDirectory) {
		await rm(bundleDirectory, { force: true, recursive: true });
	}
});

test("authenticated envelopes use Chromium WebCrypto with no rejected-body dispatch", async ({
	page,
}) => {
	await page.goto("/");
	const moduleUrl = new URL("/__runner_only_envelope_130.js", page.url()).href;
	await page.route(moduleUrl, (route) =>
		route.fulfill({ body: bundle, contentType: "text/javascript" })
	);
	const results = await page.evaluate(async (url) => {
		const codec = (await import(
			url
		)) as typeof import("../../apps/web/src/lib/crypto/data-envelope") &
			typeof import("../../apps/web/src/lib/crypto/handshake");
		const [c, j] = await Promise.all([
			codec.EphemeralHandshake.create("AAAAAAAAAAAAAAAAAAAAAA", "creator"),
			codec.EphemeralHandshake.create("AAAAAAAAAAAAAAAAAAAAAA", "joiner"),
		]);
		await Promise.all([c.acceptPeer(j.getHello()), j.acceptPeer(c.getHello())]);
		const [cProof, jProof] = await Promise.all([
			c.createConfirmation(),
			j.createConfirmation(),
		]);
		await Promise.all([
			c.acceptConfirmation(jProof),
			j.acceptConfirmation(cProof),
		]);
		const creatorResult = codec.DataEnvelopeSession.create(c);
		const joinerResult = codec.DataEnvelopeSession.create(j);
		if (!(creatorResult.ok && joinerResult.ok)) {
			throw new Error("Browser codec setup rejected");
		}
		const creator = creatorResult.value;
		const joiner = joinerResult.value;
		try {
			const bodies = [
				{
					id: "browser-test",
					text: "synthetic-browser-envelope",
					type: "message",
				},
				{ messageId: "browser-test", type: "acknowledgement" },
				{ confirmed: true, type: "verification" },
				{ type: "end" },
			];
			const frames = await Promise.all(
				bodies.map((body) => creator.encrypt(body))
			);
			const acceptedTypes: string[] = [];
			const sequences: string[] = [];
			let onlyThreeFields = true;
			for (const frame of frames) {
				if (!frame.ok) {
					throw new Error("Browser encrypt rejected");
				}
				sequences.push(frame.value.sequence);
				onlyThreeFields &&=
					Object.keys(frame.value).sort().join(",") ===
					"ciphertext,sequence,sessionId";
				const body = await joiner.decrypt(JSON.stringify(frame.value));
				if (!body.ok) {
					throw new Error("Browser decrypt rejected");
				}
				acceptedTypes.push(body.value.type);
			}
			const freshFrame = await creator.encrypt(bodies[0]);
			if (!freshFrame.ok) {
				throw new Error("Browser encrypt rejected");
			}
			const wire = JSON.stringify(freshFrame.value);
			const overCap = new TextEncoder().encode(
				wire.padEnd(codec.MAX_DATA_ENVELOPE_BYTES + 1, " ")
			);
			const rejectedFrames = [
				{ ...freshFrame.value, sequence: "99" },
				{ ...freshFrame.value, role: "creator" },
				overCap,
			];
			let rejectedDispatches = 0;
			const errors: string[] = [];
			for (const frame of rejectedFrames) {
				const body = await joiner.decrypt(frame);
				if (body.ok) {
					rejectedDispatches += 1;
				} else {
					errors.push(body.error);
				}
			}
			const preserved = await joiner.decrypt(freshFrame.value);
			const duplicate = await joiner.decrypt(freshFrame.value);
			const reverse = await joiner.encrypt({
				confirmed: true,
				type: "verification",
			});
			const reverseReceived =
				reverse.ok && (await creator.decrypt(reverse.value)).ok;
			return {
				acceptedTypes,
				declaredCap: codec.MAX_DATA_ENVELOPE_BYTES,
				duplicateRejected:
					!duplicate.ok && duplicate.error === "replay_rejected",
				errors,
				onlyThreeFields,
				overCapBytes: overCap.byteLength,
				preserved: preserved.ok,
				rejectedDispatches,
				reverseReceived,
				secureContext: isSecureContext,
				sequences,
			};
		} finally {
			creator.dispose();
			joiner.dispose();
		}
	}, moduleUrl);
	expect(results.secureContext).toBe(true);
	expect(results.acceptedTypes).toEqual([
		"message",
		"acknowledgement",
		"verification",
		"end",
	]);
	expect(results.sequences).toEqual(["0", "1", "2", "3"]);
	expect(results.onlyThreeFields).toBe(true);
	expect(results.errors).toEqual([
		"authentication_failed",
		"invalid_envelope",
		"invalid_envelope",
	]);
	expect(results.overCapBytes).toBe(results.declaredCap + 1);
	expect(results.rejectedDispatches).toBe(0);
	expect(results.preserved).toBe(true);
	expect(results.duplicateRejected).toBe(true);
	expect(results.reverseReceived).toBe(true);
});
