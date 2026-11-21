import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Overlay, OverlayStatus } from "../src/renderer/overlay/overlay";
import {
	isOverlayState,
	OVERLAY_STATES,
	overlayPresentation,
} from "../src/shared/overlay-state";

// Rendering is independent of sessions, microphone, providers and clipboard.
const bridge = {
	onStatus: () => () => {
		// Server-side rendering has no live subscription to clean up.
	},
};
const acceptanceClaim = /accepted|inserted|success|sent/i;
const interactiveMarkup = /<button|<input|tabindex|autofocus/i;

describe("overlay state-to-label contract", () => {
	for (const state of OVERLAY_STATES) {
		test(`${state} yields its visible label${state === "Done" ? " and Paste requested" : ""}`, () => {
			const view = overlayPresentation(state);
			expect(view.label).toBe(state);
			const html = renderToStaticMarkup(
				createElement(OverlayStatus, { state })
			);
			expect(html).toContain(`data-state="${state}"`);
			expect(html).toContain(`>${state}</span>`);
			expect(view.description.length).toBeGreaterThan(0);
			if (state === "Done") {
				expect(html).toContain(">Paste requested</span>");
				expect(view.description).toBe("Paste requested");
				expect(view.description).not.toMatch(acceptanceClaim);
			}
		});
	}
});

test("only the six explicit states are accepted", () => {
	for (const state of OVERLAY_STATES) {
		expect(isOverlayState(state)).toBe(true);
	}
	for (const value of [
		"Idle",
		"done",
		"Accepted",
		null,
		0,
		{ state: "Done" },
	]) {
		expect(isOverlayState(value)).toBe(false);
	}
});

test("each state has a distinct icon and active/error states invert fill", () => {
	expect(
		new Set(OVERLAY_STATES.map((state) => overlayPresentation(state).icon)).size
	).toBe(6);
	expect(overlayPresentation("Listening").inverted).toBe(true);
	expect(overlayPresentation("Error").inverted).toBe(true);
});

test("renderer is status-only, polite and non-interactive", () => {
	const html = renderToStaticMarkup(createElement(Overlay, { bridge }));
	expect(html).toContain('role="status"');
	expect(html).toContain('aria-atomic="true"');
	expect(html).toContain('aria-live="polite"');
	expect(html).not.toMatch(interactiveMarkup);
});
