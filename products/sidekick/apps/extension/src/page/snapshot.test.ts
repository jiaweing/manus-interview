import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createSnapshotObserver } from "./snapshot";

const html = readFileSync(
	new URL("./fixtures/snapshot.html", import.meta.url),
	"utf8"
);
const expected = [
	["heading", "heading", "Ordinary page"],
	["link", "link", "Read reference"],
	["name-label", "label", "Customer name"],
	["name", "textbox", "Customer name"],
	["wrapped-label", "label", "Contact email"],
	["email", "textbox", "Contact email"],
	["notes", "textbox", "Delivery notes"],
	["size", "combobox", "Pizza size"],
	["checkbox", "checkbox", "Remember choice"],
	["radio", "radio", "Morning"],
	["search", "searchbox", "Search article"],
	["button", "button", "Save draft"],
	["submit", "button", "Send example"],
	["custom", "button", "Expand details"],
	["editable", "textbox", "Editable note"],
	// Opacity-only hiding is outside the ordinary-DOM exposure contract.
	["transparent", "button", "Transparent control"],
];

function fixture() {
	const window = new Window({ url: "http://localhost:8765/fixture" });
	window.document.write(html);
	// Happy DOM has no layout engine. Model nonzero layout here; real Chromium
	// verification uses native layout and the identical locally served fixture.
	window.HTMLElement.prototype.getClientRects = () =>
		[{ height: 20, width: 100 }] as ReturnType<
			Window["HTMLElement"]["prototype"]["getClientRects"]
		>;
	const document = window.document as unknown as Document;
	const host = document.getElementById("shadow-host");
	if (host && !host.shadowRoot) {
		host.attachShadow({ mode: "open" }).innerHTML =
			'<button id="shadow-button">Shadow control</button>';
	}
	return { document, observer: createSnapshotObserver(document) };
}

describe("indexed top-frame DOM snapshots", () => {
	test("returns exact Snapshot fields, URL/title and rendered text without field values", () => {
		const { observer } = fixture();
		const snapshot = observer.observe(42);
		expect(Object.keys(snapshot).sort()).toEqual(
			[
				"snapshotId",
				"documentToken",
				"tabId",
				"url",
				"title",
				"text",
				"truncated",
				"elements",
			].sort()
		);
		expect(snapshot.tabId).toBe(42);
		expect(snapshot.url).toBe("http://localhost:8765/fixture");
		expect(snapshot.title).toBe("Snapshot fixture");
		expect(snapshot.text).toContain("Rendered evidence for observation.");
		expect(snapshot.text).not.toContain("existing-value-not-for-snapshot");
		expect(snapshot.text).not.toContain(
			"existing-textarea-value-not-for-snapshot"
		);
		expect(snapshot.truncated).toBe(false);
		expect(snapshot.snapshotId).not.toBe("");
		expect(snapshot.documentToken).not.toBe("");
	});

	test("visible controls, headings and labels have exact roles/names and unique live indexes", () => {
		const { observer, document } = fixture();
		const snapshot = observer.observe(42);
		expect(snapshot.elements).toHaveLength(expected.length);
		expect(
			new Set(snapshot.elements.map((element) => element.index)).size
		).toBe(expected.length);
		for (const [offset, [id, role, name]] of expected.entries()) {
			const descriptor = snapshot.elements[offset];
			expect(descriptor).toMatchObject({
				enabled: true,
				index: offset + 1,
				name,
				role,
			});
			expect(
				observer.resolveElement(
					snapshot.snapshotId,
					snapshot.documentToken,
					offset + 1
				)
			).toBe(document.getElementById(id ?? ""));
		}
		expect(
			snapshot.elements.find((element) => element.role === "link")?.href
		).toBe("http://localhost:8765/reference");
		expect(
			snapshot.elements.find(
				(element) =>
					element.name === "Contact email" && element.role === "textbox"
			)?.inputType
		).toBe("email");
	});

	test("hidden/disabled controls and unsupported frame/shadow/canvas/PDF contents have no actionable map entries", () => {
		const { observer } = fixture();
		const snapshot = observer.observe(1);
		const targets = snapshot.elements.map(
			(element) =>
				observer.resolveElement(
					snapshot.snapshotId,
					snapshot.documentToken,
					element.index
				)?.id
		);
		for (const id of [
			"hidden",
			"hidden-ancestor",
			"css-hidden",
			"invisible",
			"aria-hidden",
			"disabled",
			"disabled-fieldset",
			"aria-disabled",
			"inert",
			"hidden-input",
			"frame-button",
			"shadow-button",
			"canvas-button",
			"pdf-button",
		]) {
			expect(targets).not.toContain(id);
		}
		for (const text of [
			"Hidden control",
			"CSS hidden control",
			"Shadow control",
			"Frame control",
			"Canvas control",
			"PDF fallback control",
		]) {
			expect(snapshot.text).not.toContain(text);
		}
	});

	test("re-observation rotates snapshot IDs while retaining document identity and invalidating the old map", () => {
		const { observer } = fixture();
		const first = observer.observe(1);
		const second = observer.observe(1);
		expect(second.snapshotId).not.toBe(first.snapshotId);
		expect(second.documentToken).toBe(first.documentToken);
		expect(
			observer.resolveElement(first.snapshotId, first.documentToken, 1)
		).toBeNull();
		expect(
			observer.resolveElement(second.snapshotId, second.documentToken, 1)?.id
		).toBe("heading");
	});

	test("replacing the same document root rotates documentToken and discards original targets", () => {
		const { observer, document } = fixture();
		const first = observer.observe(1);
		const replacement = document.createElement("html");
		replacement.innerHTML =
			'<head><title>Replacement</title></head><body><button id="new-button">New document</button></body>';
		document.documentElement.remove();
		document.appendChild(replacement);
		expect(
			observer.resolveElement(first.snapshotId, first.documentToken, 1)
		).toBeNull();
		const second = observer.observe(1);
		expect(second.documentToken).not.toBe(first.documentToken);
		expect(second.title).toBe("Replacement");
		expect(second.elements).toEqual([
			{ enabled: true, index: 1, name: "New document", role: "button" },
		]);
		expect(
			observer.resolveElement(second.snapshotId, second.documentToken, 1)?.id
		).toBe("new-button");
	});

	test("a newly created document has a distinct token and removed live elements cannot resolve", () => {
		const first = fixture();
		const second = fixture();
		const a = first.observer.observe(1);
		const b = second.observer.observe(1);
		expect(a.documentToken).not.toBe(b.documentToken);
		first.document.getElementById("heading")?.remove();
		expect(
			first.observer.resolveElement(a.snapshotId, a.documentToken, 1)
		).toBeNull();
		expect(
			first.observer.resolveElement(a.snapshotId, a.documentToken, 999)
		).toBeNull();
	});

	test("PDF and child-frame documents are rejected rather than indexed", () => {
		const pdf = fixture();
		Object.defineProperty(pdf.document, "contentType", {
			value: "application/pdf",
		});
		expect(() => pdf.observer.observe(1)).toThrow("PDF");
		const framed = fixture();
		Object.defineProperty(framed.document.defaultView, "top", { value: {} });
		expect(() => framed.observer.observe(1)).toThrow("top-frame");
	});
});
