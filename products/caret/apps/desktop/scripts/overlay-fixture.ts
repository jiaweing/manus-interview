// biome-ignore-all lint/performance/noAwaitInLoops: Every state must be measured sequentially in the same overlay and foreground window.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron, type Page } from "playwright";
import type { OverlayController } from "../src/main/overlay";
import {
	OVERLAY_STATES,
	type OverlayState,
	overlayPresentation,
} from "../src/shared/overlay-state";

const require = createRequire(import.meta.url);
const evidence = resolve(
	import.meta.dirname,
	"../../../../../evidence/overlay"
);
const onWindows = process.platform === "win32";
const reportName = onWindows ? "windows" : "linux-fixture";
mkdirSync(resolve(evidence, "dark"), { recursive: true });
const app = await electron.launch({
	args: [
		resolve(import.meta.dirname, "../out/main/index.js"),
		"--fixture-overlay",
		...(onWindows ? [] : ["--no-sandbox", "--disable-gpu"]),
	],
	env: {
		...process.env,
		ELECTRON_ENABLE_LOGGING: "0",
		ELECTRON_RENDERER_URL: "",
	},
	executablePath: require("electron") as string,
});

interface Handles {
	focusedControl: string;
	foreground: string;
	process: string;
}
function snapshotFocus(): Handles {
	assert(onWindows, "Windows handles cannot be checked on this platform");
	const result = execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			resolve(import.meta.dirname, "overlay-focus.ps1"),
		],
		{ encoding: "utf8", windowsHide: true }
	);
	const handles = JSON.parse(result.trim()) as Handles;
	assert.notEqual(handles.foreground, "0");
	assert.notEqual(handles.focusedControl, "0");
	return handles;
}

function snapshotIfWindows(): Handles | undefined {
	return onWindows ? snapshotFocus() : undefined;
}

function contrast(foreground: string, background: string): number {
	const luminance = (value: string) => {
		const channels = value
			.match(/[\d.]+/g)
			?.slice(0, 3)
			.map(Number);
		assert(channels?.length === 3, `Unsupported color ${value}`);
		const [r, g, b] = channels.map((channel) => {
			const linear = channel / 255;
			return linear <= 0.040_45
				? linear / 12.92
				: ((linear + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const first = luminance(foreground);
	const second = luminance(background);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function styles(page: Page) {
	return page.evaluate(async () => {
		await document.fonts.ready;
		const panel = document.querySelector<HTMLElement>(".overlay");
		const label = document.querySelector<HTMLElement>(".overlay__label");
		const body = document.querySelector<HTMLElement>(".overlay__description");
		const content = document.querySelector<HTMLElement>(".overlay__content");
		if (!(panel && label && body && content)) {
			throw new Error("Missing overlay elements");
		}
		const panelStyle = getComputedStyle(panel);
		const labelStyle = getComputedStyle(label);
		const bodyStyle = getComputedStyle(body);
		const motion = getComputedStyle(content);
		return {
			animationDuration: motion.animationDuration,
			bodyColor: bodyStyle.color,
			bodyWeight: bodyStyle.fontWeight,
			clipped:
				body.scrollWidth > body.clientWidth ||
				panel.scrollHeight > panel.clientHeight,
			description: body.textContent,
			elements: Array.from(panel.querySelectorAll("*"), (element) => element)
				.concat(panel)
				.map((element) => {
					const style = getComputedStyle(element);
					return {
						background: style.backgroundColor,
						borders: [
							style.borderTopWidth,
							style.borderRightWidth,
							style.borderBottomWidth,
							style.borderLeftWidth,
						],
						color: style.color,
						outline: style.outlineWidth,
						tag: element.tagName,
					};
				}),
			font: bodyStyle.fontFamily,
			fontLoaded: document.fonts.check('14px "Inter"'),
			label: label.textContent,
			labelColor: labelStyle.color,
			labelWeight: labelStyle.fontWeight,
			radius: panelStyle.borderRadius,
			size: bodyStyle.fontSize,
			state: panel.dataset.state,
			surface: panelStyle.backgroundColor,
			transitionDuration: motion.transitionDuration,
			transitionProperty: motion.transitionProperty,
			transitionTimingFunction: motion.transitionTimingFunction,
		};
	});
}

const samples: unknown[] = [];
const handlesLog: unknown[] = [];
const allowedPalette = new Set([
	"rgb(0, 0, 0)",
	"rgb(255, 255, 255)",
	"rgb(250, 250, 250)",
	"rgb(244, 244, 245)",
	"rgb(228, 228, 231)",
	"rgb(113, 113, 122)",
	"rgb(24, 24, 27)",
	"rgba(0, 0, 0, 0)",
]);

try {
	const page = await app.firstWindow();
	await page.locator(".overlay").waitFor({ state: "attached" });
	const windowConfig = await app.evaluate(({ BrowserWindow }) => {
		const [win] = BrowserWindow.getAllWindows();
		// Runtime Electron diagnostic used only by the unpackaged test harness.
		const preferences = (
			win.webContents as typeof win.webContents & {
				getLastWebPreferences: () => Electron.WebPreferences;
			}
		).getLastWebPreferences();
		return {
			alwaysOnTop: win.isAlwaysOnTop(),
			contextIsolation: preferences.contextIsolation,
			focusable: win.isFocusable(),
			nodeIntegration: preferences.nodeIntegration,
			resizable: win.isResizable(),
			sandbox: preferences.sandbox,
			visibleInitially: win.isVisible(),
		};
	});
	assert.equal(windowConfig.focusable, false);
	assert.equal(windowConfig.alwaysOnTop, true);
	assert.equal(windowConfig.visibleInitially, false);
	assert.equal(windowConfig.resizable, false);
	assert.equal(windowConfig.contextIsolation, true);
	assert.equal(windowConfig.nodeIntegration, false);
	assert.equal(windowConfig.sandbox, true);
	assert.equal(
		await page.evaluate(
			() => typeof (window as unknown as { require?: unknown }).require
		),
		"undefined"
	);
	assert.deepEqual(
		await page.evaluate(() => Object.keys(window.caretOverlay)),
		["onStatus"]
	);

	let baseline: Handles | undefined;
	if (onWindows) {
		console.log(
			"Focus an editable Notepad control now. State cycling begins in 10 seconds; do not change focus."
		);
		await delay(10_000);
		baseline = snapshotFocus();
		assert.equal(
			baseline.process.toLowerCase(),
			"notepad",
			"Focus Notepad before the fixture starts"
		);
	} else {
		console.log(
			"NOT RUN: needs Windows — foreground/focused-control handle invariance. Linux screenshots are fixtures only."
		);
	}

	for (const theme of ["light", "dark"] as const) {
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "no-preference",
		});
		for (const state of OVERLAY_STATES) {
			const before = snapshotIfWindows();
			if (baseline && before) {
				assert.deepEqual(
					before,
					baseline,
					`Foreground changed before ${theme}/${state}`
				);
			}
			await app.evaluate((_electron, next: OverlayState) => {
				(
					globalThis as typeof globalThis & {
						caretOverlayFixture: OverlayController;
					}
				).caretOverlayFixture.setStatus(next);
			}, state);
			await page
				.locator(`.overlay[data-state="${state}"]`)
				.waitFor({ state: "visible" });
			await delay(200);
			const sample = await styles(page);
			assert.equal(sample.label, state);
			assert.equal(sample.description, overlayPresentation(state).description);
			const whiteSurface =
				(theme === "light") !== overlayPresentation(state).inverted;
			assert.equal(
				sample.surface,
				whiteSurface ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)"
			);
			assert.equal(
				sample.labelColor,
				whiteSurface ? "rgb(0, 0, 0)" : "rgb(250, 250, 250)"
			);
			assert.equal(sample.radius, "10px");
			assert.equal(sample.size, "14px");
			assert.equal(sample.font, "Inter, sans-serif");
			assert.equal(sample.fontLoaded, true);
			assert.equal(sample.labelWeight, "600");
			assert.equal(sample.bodyWeight, "400");
			assert.equal(sample.transitionDuration, "0.15s, 0.15s");
			assert.equal(sample.transitionProperty, "opacity, transform");
			assert.equal(sample.transitionTimingFunction, "ease-out, ease-out");
			assert.equal(sample.animationDuration, "0s");
			assert.equal(sample.clipped, false);
			for (const element of sample.elements) {
				assert.deepEqual(element.borders, ["0px", "0px", "0px", "0px"]);
				assert.equal(element.outline, "0px");
				assert(
					allowedPalette.has(element.color),
					`Non-palette text ${element.color}`
				);
				assert(
					allowedPalette.has(element.background),
					`Non-palette surface ${element.background}`
				);
			}
			const bodyContrast = contrast(sample.bodyColor, sample.surface);
			const labelContrast = contrast(sample.labelColor, sample.surface);
			assert(bodyContrast >= 7, `Body contrast ${bodyContrast} is below 7:1`);
			assert(
				labelContrast >= 7,
				`Label contrast ${labelContrast} is below 7:1`
			);
			const file = resolve(
				evidence,
				theme === "dark" ? "dark" : ".",
				`${state.toLowerCase()}.png`
			);
			await page.screenshot({ omitBackground: true, path: file });
			const after = snapshotIfWindows();
			if (before && after) {
				handlesLog.push({ after, before, state, theme });
				assert.deepEqual(after, before, `Focus changed at ${theme}/${state}`);
			}
			samples.push({ theme, ...sample, bodyContrast, labelContrast });
			console.log(
				`PASS ${theme}/${state}: label, no borders/outlines, radius/font/motion/palette; body contrast ${bodyContrast.toFixed(2)}:1`
			);
		}
	}

	await page.emulateMedia({ reducedMotion: "reduce" });
	const beforeReduced = snapshotIfWindows();
	await app.evaluate(() => {
		(
			globalThis as typeof globalThis & {
				caretOverlayFixture: OverlayController;
			}
		).caretOverlayFixture.setStatus("Starting");
	});
	await page.locator('.overlay[data-state="Starting"]').waitFor();
	const reduced = await styles(page);
	assert.equal(reduced.transitionDuration, "0s");
	assert.equal(reduced.animationDuration, "0s");
	samples.push({ reducedMotion: true, ...reduced });
	const afterReduced = snapshotIfWindows();
	if (beforeReduced && afterReduced) {
		handlesLog.push({
			action: "reduced-motion/Starting",
			after: afterReduced,
			before: beforeReduced,
		});
		assert.deepEqual(
			afterReduced,
			beforeReduced,
			"Focus changed on reduced-motion update"
		);
	}
	console.log("PASS reduced motion: transition 0s, animation 0s");

	// Hide/re-show exercises the non-activating display path, not just updates.
	const beforeReshow = snapshotIfWindows();
	await app.evaluate(() => {
		(
			globalThis as typeof globalThis & {
				caretOverlayFixture: OverlayController;
			}
		).caretOverlayFixture.hide();
	});
	assert.equal(
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].isVisible()
		),
		false
	);
	await app.evaluate(() => {
		(
			globalThis as typeof globalThis & {
				caretOverlayFixture: OverlayController;
			}
		).caretOverlayFixture.setStatus("Listening");
	});
	await page
		.locator('.overlay[data-state="Listening"]')
		.waitFor({ state: "visible" });
	const afterReshow = snapshotIfWindows();
	if (beforeReshow && afterReshow) {
		handlesLog.push({
			action: "hide/re-show",
			after: afterReshow,
			before: beforeReshow,
		});
		assert.deepEqual(afterReshow, beforeReshow, "Focus changed on re-show");
	}
	console.log("PASS hidden-until-status and hide/re-show lifecycle");
	writeFileSync(
		resolve(evidence, `${reportName}-styles.json`),
		`${JSON.stringify({ platform: process.platform, samples, windowConfig }, null, 2)}\n`
	);
	if (onWindows) {
		writeFileSync(
			resolve(evidence, "windows-handles.json"),
			`${JSON.stringify(handlesLog, null, 2)}\n`
		);
		console.log(
			"PASS Windows foreground/focused-control handles unchanged at every state and hide/re-show"
		);
	}
} finally {
	// Persist partial real measurements on failure, without any payload/secret data.
	if (onWindows && handlesLog.length) {
		writeFileSync(
			resolve(evidence, "windows-handles.json"),
			`${JSON.stringify(handlesLog, null, 2)}\n`
		);
	}
	await app.close();
}
