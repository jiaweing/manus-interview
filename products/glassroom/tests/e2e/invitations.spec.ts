import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

const LOGIN_LABEL = /log ?in|sign ?in/i;
// Traces can retain the pre-removal navigation URL and clipboard arguments.
test.use({ trace: "off" });

interface InvitationProbe {
	clipboard: string[];
	fragmentFreeAtSignal: boolean[];
	replacedFragment: boolean[];
}

declare global {
	interface Window {
		invitationProbe: InvitationProbe;
	}
}

async function profile(browser: Browser) {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	await context.addInitScript(() => {
		window.invitationProbe = {
			clipboard: [],
			fragmentFreeAtSignal: [],
			replacedFragment: [],
		};
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: (value: string) => {
					window.invitationProbe.clipboard.push(value);
					return Promise.resolve();
				},
			},
		});
		const NativeWebSocket = window.WebSocket;
		window.WebSocket = class extends NativeWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				if (new URL(url, location.href).pathname === "/signal") {
					window.invitationProbe.fragmentFreeAtSignal.push(
						location.hash === ""
					);
				}
				super(url, protocols);
			}
		};
		const replace = history.replaceState.bind(history);
		history.replaceState = (data, unused, url) => {
			replace(data, unused, url);
			window.invitationProbe.replacedFragment.push(location.hash === "");
		};
	});
	return { context, page: await context.newPage() };
}

function traffic(page: Page) {
	const urls: string[] = [];
	const frames: string[] = [];
	page.on("request", (request) => urls.push(request.url()));
	page.on("websocket", (socket) => {
		urls.push(socket.url());
		if (new URL(socket.url()).pathname !== "/signal") {
			return;
		}
		socket.on("framesent", ({ payload }) => frames.push(String(payload)));
		socket.on("framereceived", ({ payload }) => frames.push(String(payload)));
	});
	return { frames, urls };
}

async function create(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { exact: true, name: "Create room" }).click();
	await expect(page.getByRole("status")).toHaveText("Waiting for peer");
	await page
		.getByRole("button", { exact: true, name: "Copy invitation" })
		.click();
	return page.evaluate(() => {
		const value = window.invitationProbe.clipboard[0];
		if (!value) {
			throw new Error("Invitation was not copied");
		}
		return value;
	});
}

async function screenshot(page: Page, name: string) {
	const directory = resolve("evidence/screens");
	mkdirSync(directory, { recursive: true });
	await page.bringToFront();
	await page.screenshot({ path: resolve(directory, `133-${name}-page.png`) });
	if (process.env.INVITATION_SCREENSHOTS === "1" && process.env.DISPLAY) {
		// Headed verification captures actual browser chrome/address bar, not product test UI.
		execFileSync("ffmpeg", [
			"-y",
			"-loglevel",
			"error",
			"-f",
			"x11grab",
			"-video_size",
			"1280x900",
			"-i",
			process.env.DISPLAY,
			"-frames:v",
			"1",
			resolve(directory, `133-${name}-url.png`),
		]);
	}
}

async function closeProfiles(contexts: BrowserContext[]) {
	for (const context of contexts.reverse()) {
		await context.close();
	}
}

test("random invitation lengths", async ({ browser }) => {
	const first = await profile(browser);
	const second = await profile(browser);
	try {
		const links = [await create(first.page), await create(second.page)];
		const urls = links.map((link) => new URL(link));
		const roomIds = urls.map((url) => url.pathname.slice(3));
		const secrets = urls.map((url) => url.hash.slice(3));
		expect(
			roomIds.every(
				(value) =>
					Buffer.from(value, "base64url").byteLength === 16 &&
					Buffer.from(value, "base64url").toString("base64url") === value
			)
		).toBe(true);
		expect(
			secrets.every(
				(value) =>
					Buffer.from(value, "base64url").byteLength === 32 &&
					Buffer.from(value, "base64url").toString("base64url") === value
			)
		).toBe(true);
		expect(roomIds[0] !== roomIds[1] && secrets[0] !== secrets[1]).toBe(true);
	} finally {
		await closeProfiles([first.context, second.context]);
	}
});

test("deliberate copy only", async ({ browser }) => {
	const { context, page } = await profile(browser);
	try {
		await page.goto("/");
		expect(
			await page.evaluate(() => window.invitationProbe.clipboard.length)
		).toBe(0);
		await page
			.getByRole("button", { exact: true, name: "Create room" })
			.click();
		await expect(page.getByRole("status")).toHaveText("Waiting for peer");
		expect(
			await page.evaluate(() => window.invitationProbe.clipboard.length)
		).toBe(0);
		await page
			.getByRole("button", { exact: true, name: "Copy invitation" })
			.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByText("Invitation copied.", { exact: false })
		).toBeVisible();
		expect(
			await page.evaluate(() => window.invitationProbe.clipboard.length)
		).toBe(1);
	} finally {
		await context.close();
	}
});

test("strip before signal", async ({ browser }) => {
	const creator = await profile(browser);
	const joiner = await profile(browser);
	const creatorTraffic = traffic(creator.page);
	const joinerTraffic = traffic(joiner.page);
	try {
		const link = await create(creator.page);
		const secret = new URL(link).hash.slice(3);
		await joiner.page.goto(link);
		await expect(joiner.page.getByRole("status")).toHaveText(
			"Peer joined. Identity is not yet verified."
		);
		expect(new URL(joiner.page.url()).hash === "").toBe(true);
		const probe = await joiner.page.evaluate(() => ({
			replacements: window.invitationProbe.replacedFragment,
			signals: window.invitationProbe.fragmentFreeAtSignal,
		}));
		expect(probe.signals).toEqual([true]);
		expect(probe.replacements.includes(true)).toBe(true);
		await screenshot(joiner.page, "joined");
		const allUrls = [...creatorTraffic.urls, ...joinerTraffic.urls];
		const allFrames = [...creatorTraffic.frames, ...joinerTraffic.frames];
		const secretAbsent = [...allUrls, ...allFrames].every(
			(value) => !(value.includes(secret) || value.includes("#s="))
		);
		expect(secretAbsent).toBe(true);
		const sentAdmission = allFrames.filter(
			(frame) => JSON.parse(frame).operation === "join"
		);
		expect(sentAdmission.length).toBe(2);
		expect(
			sentAdmission.every(
				(frame) =>
					Object.keys(JSON.parse(frame)).sort().join(",") ===
					"operation,role,roomId,version"
			)
		).toBe(true);
		const redact = (value: string) =>
			value.replaceAll(new URL(link).pathname.slice(3), "<room-id>");
		const directory = resolve("evidence/issues/133");
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			resolve(directory, "requests.redacted.json"),
			`${JSON.stringify({ fragmentFreeAtFirstSignal: probe.signals, httpAndWsUrls: allUrls.map(redact), joinedUrl: redact(joiner.page.url()), secretAbsent, wsFrames: allFrames.map((value) => JSON.parse(redact(value))) }, null, 2)}\n`
		);
		const storageEmpty = await joiner.page.evaluate(
			async () =>
				localStorage.length === 0 &&
				sessionStorage.length === 0 &&
				(await indexedDB.databases()).length === 0 &&
				(await navigator.serviceWorker.getRegistrations()).length === 0
		);
		expect(storageEmpty).toBe(true);
		expect((await joiner.context.cookies()).length).toBe(0);
	} finally {
		await closeProfiles([creator.context, joiner.context]);
	}
});

for (const [name, hashes] of [
	["missing secret stays local", ["", "#s="]],
	[
		"invalid secret stays local",
		[
			"#s=short",
			`#s=${"A".repeat(42)}B`,
			`#s=${"A".repeat(43)}=`,
			`#s=${"A".repeat(43)}&s=${"A".repeat(43)}`,
		],
	],
] as const) {
	test(name, async ({ browser, baseURL }) => {
		const { context, page } = await profile(browser);
		const requests = traffic(page);
		try {
			for (const hash of hashes) {
				await page.goto(`${baseURL}/r/${"A".repeat(22)}${hash}`);
				await expect(page.getByRole("status")).toHaveText(
					name.startsWith("missing")
						? "Missing invitation secret. Ask for the complete link."
						: "Invalid invitation. Ask for a fresh link."
				);
				expect(
					await page.evaluate(
						() => window.invitationProbe.fragmentFreeAtSignal.length
					)
				).toBe(0);
				await expect.poll(() => new URL(page.url()).hash === "").toBe(true);
			}
			expect(
				requests.urls.some((url) => new URL(url).pathname === "/signal")
			).toBe(false);
		} finally {
			await context.close();
		}
	});
}

test("no-login third-person rejection", async ({ browser }) => {
	const creator = await profile(browser);
	const joiner = await profile(browser);
	const third = await profile(browser);
	try {
		const link = await create(creator.page);
		await joiner.page.goto(link);
		await expect(joiner.page.getByRole("status")).toHaveText(
			"Peer joined. Identity is not yet verified."
		);
		await third.page.goto(link);
		await expect(third.page.getByRole("status")).toHaveText(
			"Room full or unavailable. Ask for a fresh invitation."
		);
		expect(new URL(third.page.url()).hash === "").toBe(true);
		await screenshot(third.page, "room-full");
		await expect(creator.page.getByRole("status")).toHaveText(
			"Peer joined. Identity is not yet verified."
		);
		await expect(joiner.page.getByRole("status")).toHaveText(
			"Peer joined. Identity is not yet verified."
		);
		for (const { page } of [creator, joiner, third]) {
			expect(await page.getByRole("textbox").count()).toBe(0);
			expect(
				await page.getByRole("button", { name: LOGIN_LABEL }).count()
			).toBe(0);
		}
	} finally {
		await closeProfiles([creator.context, joiner.context, third.context]);
	}
});

test("refresh ends old invitation without reconnection", async ({
	browser,
}) => {
	const creator = await profile(browser);
	const joiner = await profile(browser);
	try {
		const link = await create(creator.page);
		await joiner.page.goto(link);
		await expect(joiner.page.getByRole("status")).toHaveText(
			"Peer joined. Identity is not yet verified."
		);
		await joiner.page.reload();
		await expect(joiner.page.getByRole("status")).toHaveText(
			"Missing invitation secret. Ask for the complete link."
		);
		expect(
			await joiner.page.evaluate(
				() => window.invitationProbe.fragmentFreeAtSignal.length
			)
		).toBe(0);
		await expect(creator.page.getByRole("status")).toHaveText(
			"Room ended. Create a fresh room; old invitations cannot reconnect."
		);
		await expect(
			creator.page.getByRole("button", { name: "Copy invitation" })
		).toHaveCount(0);
		await creator.page.goto(link);
		await expect.poll(() => new URL(creator.page.url()).hash === "").toBe(true);
		expect(
			await creator.page.evaluate(
				() => window.invitationProbe.fragmentFreeAtSignal.length
			)
		).toBe(1);
		await expect(creator.page.getByRole("status")).toHaveText(
			"Room ended. Create a fresh room; old invitations cannot reconnect."
		);
	} finally {
		await closeProfiles([creator.context, joiner.context]);
	}
});

test("invalid room ID stays local and Back does not restore the fragment", async ({
	browser,
	baseURL,
}) => {
	const { context, page } = await profile(browser);
	try {
		await page.goto("/");
		await page.goto(`${baseURL}/r/${"A".repeat(21)}B#s=${"A".repeat(43)}`);
		await expect(page.getByRole("status")).toHaveText(
			"Invalid invitation. Ask for a fresh link."
		);
		expect(
			await page.evaluate(
				() => window.invitationProbe.fragmentFreeAtSignal.length
			)
		).toBe(0);
		await page.goBack();
		await expect(
			page.getByRole("button", { exact: true, name: "Create room" })
		).toBeVisible();
		await page.goForward();
		expect(new URL(page.url()).hash === "").toBe(true);
		await expect(page.getByRole("status")).toHaveText(
			"Invalid invitation. Ask for a fresh link."
		);
	} finally {
		await context.close();
	}
});

test("native clipboard copies only on deliberate action", async ({
	browser,
}) => {
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		permissions: ["clipboard-read", "clipboard-write"],
	});
	const page = await context.newPage();
	try {
		await page.goto("/");
		await page.evaluate(() => navigator.clipboard.writeText(""));
		await page
			.getByRole("button", { exact: true, name: "Create room" })
			.click();
		await expect(page.getByRole("status")).toHaveText("Waiting for peer");
		expect(
			await page.evaluate(
				async () => (await navigator.clipboard.readText()) === ""
			)
		).toBe(true);
		await page
			.getByRole("button", { exact: true, name: "Copy invitation" })
			.click();
		await expect(
			page.getByText("Invitation copied.", { exact: false })
		).toBeVisible();
		const validClipboard = await page.evaluate(async () => {
			const url = new URL(await navigator.clipboard.readText());
			const room = url.pathname.slice(3);
			const secret = url.hash.slice(3);
			const decodedLength = (value: string) =>
				atob(value.replaceAll("-", "+").replaceAll("_", "/")).length;
			return (
				url.origin === location.origin &&
				url.pathname === location.pathname &&
				url.hash.startsWith("#s=") &&
				decodedLength(room) === 16 &&
				decodedLength(secret) === 32
			);
		});
		expect(validClipboard).toBe(true);
	} finally {
		await page
			.evaluate(() => navigator.clipboard.writeText(""))
			.catch(() => undefined);
		await context.close();
	}
});
