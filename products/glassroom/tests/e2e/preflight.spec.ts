/// <reference lib="dom" />

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";

const NEGOTIATION_BOUND_MS = 10_000;
// Leave room for the runner to collect and close both endpoints inside the bound.
const PROBE_TIMEOUT_MS = 9500;
const PROBES = [
	"glassroom-preflight-from-a",
	"glassroom-preflight-from-b",
] as const;

type ChannelSettings = {
	label: string;
	ordered: boolean;
	maxRetransmits: number | null;
	maxPacketLifeTime: number | null;
};
type ProbeState = {
	pc: RTCPeerConnection;
	channel?: RTCDataChannel;
	received: string[];
	candidateTypes: string[];
	settings: ChannelSettings | null;
	timer: ReturnType<typeof setTimeout> | undefined;
	done: Promise<void>;
	finish: (status: "passed" | "failed", reason?: string) => void;
	status: "negotiating" | "passed" | "failed";
	reason: string | null;
	elapsedMs: number | null;
};
declare global {
	interface Window {
		__glassroomPreflight: ProbeState;
	}
}

async function initialize(page: Page, outgoing: string, incoming: string) {
	await page.evaluate(
		({ outgoing: outgoingProbe, incoming: incomingProbe, timeout }) => {
			const started = performance.now();
			const pc = new RTCPeerConnection({
				iceServers: [],
				iceTransportPolicy: "all",
			});
			let resolveDone!: () => void;
			const done = new Promise<void>((resolve) => {
				resolveDone = resolve;
			});
			const state: ProbeState = {
				candidateTypes: [],
				done,
				elapsedMs: null,
				finish(status, reason) {
					if (state.status !== "negotiating") {
						return;
					}
					state.status = status;
					state.reason = reason ?? null;
					state.elapsedMs = performance.now() - started;
					clearTimeout(state.timer);
					if (status === "failed") {
						pc.close();
					}
					resolveDone();
				},
				pc,
				reason: null,
				received: [],
				settings: null,
				status: "negotiating",
				timer: undefined,
			};
			state.timer = setTimeout(
				() =>
					state.finish(
						"failed",
						"direct-connectivity-timeout; delivery blocked"
					),
				timeout
			);
			pc.onicecandidate = ({ candidate }) => {
				if (candidate?.type) {
					state.candidateTypes.push(candidate.type);
				}
			};
			const bind = (channel: RTCDataChannel) => {
				state.channel = channel;
				channel.onopen = () => {
					state.settings = {
						label: channel.label,
						maxPacketLifeTime: channel.maxPacketLifeTime,
						maxRetransmits: channel.maxRetransmits,
						ordered: channel.ordered,
					};
					channel.send(outgoingProbe);
				};
				channel.onmessage = ({ data }) => {
					state.received.push(String(data));
					state.finish(
						data === incomingProbe ? "passed" : "failed",
						data === incomingProbe ? undefined : "unexpected probe"
					);
				};
				channel.onerror = () =>
					state.finish("failed", "direct channel error; delivery blocked");
			};
			pc.ondatachannel = ({ channel }) => bind(channel);
			if (outgoingProbe.endsWith("-a")) {
				bind(pc.createDataChannel("glassroom-preflight", { ordered: true }));
			}
			window.__glassroomPreflight = state;
		},
		{ incoming, outgoing, timeout: PROBE_TIMEOUT_MS }
	);
}

// SDP includes gathered ICE candidates; only the Playwright runner carries it.
// Neither /signal nor a shipped route, global, or UI implements this harness.
function description(page: Page, type: "offer" | "answer") {
	return page.evaluate(async (descriptionType) => {
		const { pc, done } = window.__glassroomPreflight;
		await pc.setLocalDescription(
			descriptionType === "offer"
				? await pc.createOffer()
				: await pc.createAnswer()
		);
		if (pc.iceGatheringState !== "complete") {
			await Promise.race([
				new Promise<void>((resolve) => {
					pc.addEventListener("icegatheringstatechange", () => {
						if (pc.iceGatheringState === "complete") {
							resolve();
						}
					});
				}),
				done,
			]);
		}
		if (
			window.__glassroomPreflight.status === "failed" ||
			!pc.localDescription
		) {
			throw new Error("Direct negotiation failed; delivery blocked");
		}
		return { sdp: pc.localDescription.sdp, type: pc.localDescription.type };
	}, type);
}

function snapshot(page: Page) {
	return page.evaluate(async () => {
		const state = window.__glassroomPreflight;
		const stats = await state.pc.getStats();
		const selectedPairs: { localType: string; remoteType: string }[] = [];
		for (const stat of stats.values()) {
			if (stat.type === "transport" && stat.selectedCandidatePairId) {
				const pair = stats.get(stat.selectedCandidatePairId);
				const local = pair && stats.get(pair.localCandidateId);
				const remote = pair && stats.get(pair.remoteCandidateId);
				if (local && remote) {
					selectedPairs.push({
						localType: local.candidateType,
						remoteType: remote.candidateType,
					});
				}
			}
		}
		return {
			candidateTypes: state.candidateTypes,
			channelSettings: state.settings,
			configuration: state.pc.getConfiguration(),
			connectionState: state.pc.connectionState,
			elapsedMs: state.elapsedMs,
			origin: location.origin,
			reason: state.reason,
			received: state.received,
			secureContext: isSecureContext,
			selectedPairs,
			status: state.status,
			userAgent: navigator.userAgent,
		};
	});
}

async function runPreflight(
	baseURL: string,
	launchOptions: Parameters<typeof chromium.launchPersistentContext>[1],
	testInfo: TestInfo,
	blocked: boolean
) {
	const profiles: string[] = [];
	const contexts: BrowserContext[] = [];
	const fallbackAttempts: string[] = [];
	let droppedCandidates = 0;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let record: Record<string, unknown> = {};
	try {
		// Separate real Chromium processes and persistent desktop profiles, not two tabs
		// or incognito contexts in one process. Temp profiles are always deleted below.
		for (const name of ["a", "b"]) {
			const profile = await mkdtemp(
				join(tmpdir(), `glassroom-preflight-${name}-`)
			);
			profiles.push(profile);
			const context = await chromium.launchPersistentContext(profile, {
				...launchOptions,
				channel: "chromium", // full desktop Chromium, never headless_shell
				headless: true,
				ignoreHTTPSErrors: true,
				serviceWorkers: "block",
				viewport: { height: 720, width: 1280 },
			});
			contexts.push(context);
		}
		const pages = await Promise.all(
			contexts.map(async (context) => {
				const page = context.pages()[0] ?? (await context.newPage());
				await page.goto(baseURL);
				return page;
			})
		);
		const [a, b] = pages as [Page, Page];
		// Do not count framework assets/HMR or Chromium's delayed favicon request
		// as fallback traffic. Reject and count all other HTTP/new WebSocket attempts.
		for (const page of pages) {
			await page.route("**/*", async (route) => {
				const path = new URL(route.request().url()).pathname;
				if (
					path.startsWith("/_next/") ||
					(path === "/favicon.ico" && route.request().method() === "GET")
				) {
					return route.continue();
				}
				fallbackAttempts.push(`HTTP ${route.request().method()} ${path}`);
				await route.abort();
			});
			await page.routeWebSocket("**/*", (socket) => {
				const path = new URL(socket.url()).pathname;
				if (path.startsWith("/_next/")) {
					socket.connectToServer();
				} else {
					fallbackAttempts.push(`WebSocket ${path}`);
					socket.close();
				}
			});
		}
		const started = performance.now();
		let failure: string | null = null;
		try {
			await Promise.race([
				(async () => {
					await Promise.all([
						initialize(a, PROBES[0], PROBES[1]),
						initialize(b, PROBES[1], PROBES[0]),
					]);
					const exchange = async (
						from: Page,
						to: Page,
						type: "offer" | "answer"
					) => {
						const sdp = await description(from, type);
						if (blocked) {
							// Fault injection: withhold ALL direct addresses in both directions.
							// End-of-candidates is retained, and there is no trickle ICE or retry.
							sdp.sdp = sdp.sdp.replace(/^a=candidate:.*\r?\n/gm, () => {
								droppedCandidates += 1;
								return "";
							});
						}
						await to.evaluate(async (remoteDescription) => {
							await window.__glassroomPreflight.pc.setRemoteDescription(
								remoteDescription
							);
						}, sdp);
					};
					await exchange(a, b, "offer");
					await exchange(b, a, "answer");
					await Promise.all(
						pages.map((page) =>
							page.evaluate(() => window.__glassroomPreflight.done)
						)
					);
				})(),
				new Promise<never>((_, reject) => {
					watchdog = setTimeout(
						() =>
							reject(
								new Error("ten-second negotiation bound; delivery blocked")
							),
						NEGOTIATION_BOUND_MS
					);
				}),
			]);
		} catch (error) {
			failure =
				error instanceof Error
					? error.message
					: "direct negotiation failed; delivery blocked";
		} finally {
			clearTimeout(watchdog);
			await Promise.all(
				pages.map((page) =>
					page.evaluate(() => {
						window.__glassroomPreflight?.finish(
							"failed",
							"direct negotiation failed; delivery blocked"
						);
					})
				)
			);
		}
		const negotiationElapsedMs = performance.now() - started;
		const peers = await Promise.all(pages.map(snapshot));
		const status =
			peers.every((peer) => peer.status === "passed") && !failure
				? "passed"
				: "failed";
		record = {
			chromiumVersions: contexts.map((context) => context.browser()?.version()),
			deliveryBlocked: status === "failed",
			desktop: true,
			droppedCandidates,
			failure,
			fallbackAttempts,
			faultInjection: blocked
				? "runner withholds all SDP ICE candidates in both directions"
				: "none",
			headless: true,
			negotiationBoundMs: NEGOTIATION_BOUND_MS,
			negotiationElapsedMs,
			network:
				process.env.PREFLIGHT_NETWORK ??
				"local sandbox network; two desktop Chromium profiles on the same host",
			networkInterfaces: Object.entries(networkInterfaces()).flatMap(
				([name, entries]) =>
					(entries ?? []).map(({ family, internal }) => ({
						family,
						internal,
						name,
					}))
			),
			networkLimit:
				"This establishes same-host direct connectivity only; rerun on the intended demo/judge network before delivery.",
			peers,
			probeTimeoutMs: PROBE_TIMEOUT_MS,
			relayCandidates: peers.flatMap((peer) =>
				peer.candidateTypes.filter((type) => type === "relay")
			).length,
			scenario: blocked ? "blocked-connectivity" : "two-profile direct channel",
			separatePersistentProfiles: profiles,
			status,
			testedOrigin: baseURL,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(record, null, 2));
		expect(profiles[0]).not.toBe(profiles[1]);
		expect(fallbackAttempts).toEqual([]);
		expect(record.relayCandidates).toBe(0);
		expect(negotiationElapsedMs).toBeLessThan(NEGOTIATION_BOUND_MS);
		for (const peer of peers) {
			expect(peer.secureContext).toBe(true);
			expect(peer.origin).toBe(new URL(baseURL).origin);
			expect(peer.configuration.iceServers).toEqual([]);
		}
		if (blocked) {
			expect(droppedCandidates).toBeGreaterThan(0);
			expect(status).toBe("failed");
			for (const peer of peers) {
				expect(peer.status).toBe("failed");
				expect(peer.reason).toContain("delivery blocked");
				expect(peer.received).toEqual([]);
				expect(peer.connectionState).toBe("closed");
				expect(peer.selectedPairs).toEqual([]);
			}
		} else {
			// A real failure is a failing Playwright test and blocks delivery. No skips,
			// expected failures, server relay, or alternate transport on restrictive networks.
			expect(status, "Direct WebRTC preflight failed: DELIVERY BLOCKED").toBe(
				"passed"
			);
			expect(peers[0]?.received).toEqual([PROBES[1]]);
			expect(peers[1]?.received).toEqual([PROBES[0]]);
			for (const peer of peers) {
				expect(peer.channelSettings).toEqual({
					label: "glassroom-preflight",
					maxPacketLifeTime: null,
					maxRetransmits: null,
					ordered: true,
				});
				expect(peer.selectedPairs.length).toBeGreaterThan(0);
				expect(
					peer.selectedPairs.some(
						(pair) => pair.localType === "relay" || pair.remoteType === "relay"
					)
				).toBe(false);
			}
		}
	} catch (error) {
		// Setup failures also leave an explicit record rather than disappearing.
		if (!record.status) {
			record = {
				deliveryBlocked: true,
				failure: error instanceof Error ? error.message : String(error),
				network: process.env.PREFLIGHT_NETWORK ?? "local sandbox network",
				status: "failed",
				testedOrigin: baseURL,
				timestamp: new Date().toISOString(),
			};
		}
		throw error;
	} finally {
		clearTimeout(watchdog);
		try {
			const path = testInfo.outputPath("preflight-network-version.json");
			await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
			await testInfo.attach("preflight-network-version", {
				contentType: "application/json",
				path,
			});
		} finally {
			try {
				// Wait for every close, even if another context rejects early.
				const closes = await Promise.allSettled(
					contexts.map((context) => context.close())
				);
				const errors = closes.flatMap((result) =>
					result.status === "rejected" ? [result.reason] : []
				);
				expect(errors, "Preflight browser cleanup failed").toEqual([]);
			} finally {
				// Evidence or close failures must never skip any profile's removal.
				const removals = await Promise.allSettled(
					profiles.map((profile) =>
						rm(profile, { force: true, recursive: true })
					)
				);
				const errors = removals.flatMap((result) =>
					result.status === "rejected" ? [result.reason] : []
				);
				expect(errors, "Preflight profile cleanup failed").toEqual([]);
			}
		}
	}
}

test("two-profile direct channel", async ({
	baseURL,
	launchOptions,
}, testInfo) => {
	test.setTimeout(45_000); // launch/navigation are separate from the negotiation deadline
	await runPreflight(baseURL as string, launchOptions, testInfo, false);
});

test("blocked-connectivity fails without relay or fallback", async ({
	baseURL,
	launchOptions,
}, testInfo) => {
	test.setTimeout(45_000);
	await runPreflight(baseURL as string, launchOptions, testInfo, true);
});
