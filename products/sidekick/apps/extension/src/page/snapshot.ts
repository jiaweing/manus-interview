import { isExposed } from "./exposure";
import {
	boundedText,
	checkControlValue,
	explicitRole,
	hasPrivateTextAncestor,
	MAX_DESCRIPTOR_NAME,
	MAX_SNAPSHOT_ELEMENTS,
	validateObservationQuery,
} from "./snapshot-privacy";

export interface SnapshotElement {
	enabled: boolean;
	href?: string;
	index: number;
	inputType?: string;
	name: string;
	role: string;
}

export interface Snapshot {
	documentToken: string;
	elements: SnapshotElement[];
	snapshotId: string;
	tabId: number;
	text: string;
	title: string;
	truncated: boolean;
	url: string;
}

const candidates =
	"a[href],button,input,select,textarea,h1,h2,h3,h4,h5,h6,label,[role],[contenteditable='true']";
const supportedRoles = new Set([
	"button",
	"link",
	"textbox",
	"searchbox",
	"checkbox",
	"radio",
	"switch",
	"combobox",
	"listbox",
	"option",
	"heading",
	"label",
	"slider",
	"spinbutton",
]);
const headingTag = /^h[1-6]$/;
const whitespace = /\s+/g;

function normalize(text: string): string {
	return text.replace(whitespace, " ").trim();
}

/** No iframe/shadow-root traversal: all queries and TreeWalkers stay in this document. */
export const isRendered = isExposed;

export function isEnabled(element: Element): boolean {
	for (const fieldset of element.ownerDocument.querySelectorAll(
		"fieldset[disabled]"
	)) {
		const legend = Array.from(fieldset.children).find(
			(child) => child.localName === "legend"
		);
		if (
			fieldset.contains(element) &&
			!legend?.contains(element) &&
			element.matches("input,select,textarea,button")
		) {
			return false;
		}
	}
	return !(
		element.matches(":disabled") ||
		element.closest('[aria-disabled="true"], [inert]')
	);
}

function roleFor(element: Element): string | undefined {
	const explicit = explicitRole(element);
	if (explicit) {
		return supportedRoles.has(explicit) ? explicit : undefined;
	}
	const tag = element.localName;
	if (headingTag.test(tag)) {
		return "heading";
	}
	switch (tag) {
		case "a":
			return element.hasAttribute("href") ? "link" : undefined;
		case "button":
			return "button";
		case "label":
			return "label";
		case "textarea":
			return "textbox";
		case "select":
			return element.hasAttribute("multiple") ? "listbox" : "combobox";
		case "input": {
			const type = (element.getAttribute("type") ?? "text").toLowerCase();
			switch (type) {
				case "hidden":
					return undefined;
				case "button":
				case "submit":
				case "reset":
				case "image":
					return "button";
				case "checkbox":
					return "checkbox";
				case "radio":
					return "radio";
				case "range":
					return "slider";
				case "number":
					return "spinbutton";
				case "search":
					return "searchbox";
				default:
					return "textbox";
			}
		}
		default:
			return element.getAttribute("contenteditable") === "true"
				? "textbox"
				: undefined;
	}
}

function renderedText(root: Element): string {
	const document = root.ownerDocument;
	const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
	const text: string[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement;
		if (parent && !hasPrivateTextAncestor(parent) && isExposed(node)) {
			const value = normalize(node.textContent ?? "");
			if (value) {
				text.push(value);
			}
		}
	}
	return text.join("\n");
}

function referenceText(element: Element, attribute: string): string {
	return normalize(
		(element.getAttribute(attribute) ?? "")
			.split(whitespace)
			.map((id) => {
				const reference = element.ownerDocument.getElementById(id);
				return isExposed(reference) && reference ? renderedText(reference) : "";
			})
			.join(" ")
	);
}

function nameFor(element: Element): string {
	if (!isExposed(element)) {
		return "";
	}
	const labelledBy = referenceText(element, "aria-labelledby");
	if (labelledBy) {
		return labelledBy;
	}
	const ariaLabel = element.getAttribute("aria-label");
	if (ariaLabel) {
		return normalize(ariaLabel);
	}
	if (
		element.localName === "input" &&
		["button", "submit", "reset"].includes(element.getAttribute("type") ?? "")
	) {
		return normalize(
			element.getAttribute("value") ??
				(element.getAttribute("type") === "submit" ? "Submit" : "Reset")
		);
	}
	// Native labels are resolved without reading existing input/textarea values.
	if ("labels" in element) {
		const labels = element.labels as NodeListOf<HTMLLabelElement> | null;
		const name = normalize(
			Array.from(labels ?? [])
				.filter(isExposed)
				.map(renderedText)
				.join(" ")
		);
		if (name) {
			return name;
		}
	}
	const text = normalize(renderedText(element));
	if (text) {
		return text;
	}
	return normalize(
		element.getAttribute("alt") ??
			element.getAttribute("title") ??
			element.getAttribute("placeholder") ??
			referenceText(element, "aria-describedby")
	);
}

interface DocumentState {
	documentToken: string;
	root: Element;
	snapshotId: string;
	targets: Map<number, Element>;
}

function observationScopes(document: Document, search?: string): Element[] {
	if (!search) {
		return [];
	}
	return Array.from(
		document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,label,button")
	).filter(
		(element) =>
			isExposed(element) &&
			normalize(renderedText(element))
				.toLowerCase()
				.includes(search.toLowerCase())
	);
}

function permittedRole(element: Element): string | undefined {
	if (
		hasPrivateTextAncestor(element.parentElement) ||
		(element.localName === "input" &&
			["password", "hidden"].includes((element as HTMLInputElement).type)) ||
		!isExposed(element) ||
		!isEnabled(element)
	) {
		return undefined;
	}
	return roleFor(element);
}

function descriptorFor(
	element: Element,
	index: number,
	role: string,
	name: string
) {
	const descriptor: SnapshotElement = {
		enabled: true,
		index,
		name: name.slice(0, MAX_DESCRIPTOR_NAME),
		role,
	};
	let truncated = name.length > MAX_DESCRIPTOR_NAME;
	if (element.localName === "input") {
		descriptor.inputType = (element as HTMLInputElement).type;
	}
	if (element.localName === "a") {
		const { href } = element as HTMLAnchorElement;
		if (href.length <= 8192) {
			descriptor.href = href;
		} else {
			truncated = true;
		}
	}
	return { descriptor, truncated };
}

function indexedDescriptors(
	document: Document,
	current: DocumentState,
	search?: string
) {
	const elements: SnapshotElement[] = [];
	const scopes = observationScopes(document, search);
	let truncated = false;
	for (const element of document.querySelectorAll(candidates)) {
		const role = permittedRole(element);
		if (!role) {
			continue;
		}
		const name = nameFor(element);
		if (
			search &&
			!name.toLowerCase().includes(search.toLowerCase()) &&
			!scopes.some((scope) => scope.contains(element))
		) {
			truncated = true;
			continue;
		}
		if (elements.length >= MAX_SNAPSHOT_ELEMENTS) {
			truncated = true;
			break;
		}
		const index = elements.length + 1;
		const result = descriptorFor(element, index, role, name);
		truncated ||= result.truncated;
		elements.push(result.descriptor);
		current.targets.set(index, element);
	}
	return { elements, truncated };
}

/** Keep this observer in the isolated content-script world, never send the target map. */
export function createSnapshotObserver(document: Document) {
	let state: DocumentState | undefined;
	function currentState(): DocumentState {
		const root = document.documentElement;
		if (!root) {
			throw new Error("The page has no document element");
		}
		if (!state || state.root !== root) {
			state = {
				documentToken: crypto.randomUUID(),
				root,
				snapshotId: "",
				targets: new Map(),
			};
		}
		return state;
	}
	return {
		checkValue(
			snapshotId: string,
			documentToken: string,
			index: number,
			expected: string
		) {
			const element = this.resolveElement(snapshotId, documentToken, index);
			return checkControlValue(
				element && isExposed(element) && isEnabled(element) ? element : null,
				expected
			);
		},
		/** Literal find-text uses exactly the same permitted text/index pipeline. */
		findText(tabId: number, query: string): Snapshot {
			return this.observe(tabId, query);
		},
		observe(tabId: number, query?: string): Snapshot {
			const search = validateObservationQuery(query);
			if (document.defaultView?.top !== document.defaultView) {
				throw new Error("Sidekick supports top-frame documents only");
			}
			if (document.contentType === "application/pdf") {
				throw new Error("Sidekick does not support PDF documents");
			}
			const current = currentState();
			current.snapshotId = crypto.randomUUID();
			current.targets = new Map();
			const observation = boundedText(
				renderedText(document.body ?? current.root),
				search
			);
			const descriptors = indexedDescriptors(document, current, search);
			return {
				documentToken: current.documentToken,
				elements: descriptors.elements,
				snapshotId: current.snapshotId,
				tabId,
				text: observation.text,
				title: document.title.slice(0, MAX_DESCRIPTOR_NAME),
				truncated:
					observation.truncated ||
					descriptors.truncated ||
					document.title.length > MAX_DESCRIPTOR_NAME,
				url: document.URL,
			};
		},
		resolveElement(
			snapshotId: string,
			documentToken: string,
			index: number
		): Element | null {
			const current = currentState();
			if (
				current.snapshotId !== snapshotId ||
				current.documentToken !== documentToken
			) {
				return null;
			}
			const element = current.targets.get(index);
			return element?.isConnected && element.ownerDocument === document
				? element
				: null;
		},
	};
}

export type SnapshotObserver = ReturnType<typeof createSnapshotObserver>;
