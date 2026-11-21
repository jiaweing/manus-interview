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
const unsupported = "iframe,canvas,object,embed";
const textExcluded = `${unsupported},script,style,noscript,template,input,textarea,select`;
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
export function isRendered(element: Element): boolean {
	const view = element.ownerDocument.defaultView;
	if (!view || element.closest(unsupported)) {
		return false;
	}
	for (
		let ancestor: Element | null = element;
		ancestor;
		ancestor = ancestor.parentElement
	) {
		if (
			ancestor.hasAttribute("hidden") ||
			ancestor.hasAttribute("inert") ||
			ancestor.getAttribute("aria-hidden") === "true"
		) {
			return false;
		}
		const style = view.getComputedStyle(ancestor);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.visibility === "collapse" ||
			style.opacity === "0"
		) {
			return false;
		}
	}
	return Array.from(element.getClientRects()).some(
		(rect) => rect.width > 0 && rect.height > 0
	);
}

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
	const explicit = element.getAttribute("role")?.split(whitespace)[0];
	if (explicit && supportedRoles.has(explicit)) {
		return explicit;
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
		if (parent && !parent.closest(textExcluded) && isRendered(parent)) {
			const value = normalize(node.textContent ?? "");
			if (value) {
				text.push(value);
			}
		}
	}
	return text.join("\n");
}

function nameFor(element: Element): string {
	const document = element.ownerDocument;
	const labelledBy = element.getAttribute("aria-labelledby");
	if (labelledBy) {
		const names = labelledBy.split(whitespace).map((id) => {
			const label = document.getElementById(id);
			return label && isRendered(label) ? renderedText(label) : "";
		});
		const name = normalize(names.join(" "));
		if (name) {
			return name;
		}
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
				.filter(isRendered)
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
			""
	);
}

/** Shared, position-independent semantics; text/visibility stay local to preflight. */
export function renderedSemantics(element: Element) {
	const descriptor: Omit<SnapshotElement, "index"> = {
		enabled: isEnabled(element),
		name: nameFor(element),
		role: roleFor(element) ?? "",
	};
	if (element.localName === "input") {
		descriptor.inputType = (
			element.getAttribute("type") ?? "text"
		).toLowerCase();
	}
	if (element.localName === "a") {
		descriptor.href = (element as HTMLAnchorElement).href;
	}
	return {
		descriptor,
		text: normalize(renderedText(element)),
		visible: isRendered(element),
	};
}

interface DocumentState {
	documentToken: string;
	root: Element;
	snapshotId: string;
	targets: Map<number, Element>;
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
		matchesSnapshot(snapshotId: string, documentToken: string): boolean {
			const current = currentState();
			return (
				current.snapshotId === snapshotId &&
				current.documentToken === documentToken
			);
		},
		observe(tabId: number): Snapshot {
			if (document.defaultView?.top !== document.defaultView) {
				throw new Error("Sidekick supports top-frame documents only");
			}
			if (document.contentType === "application/pdf") {
				throw new Error("Sidekick does not support PDF documents");
			}
			const current = currentState();
			current.snapshotId = crypto.randomUUID();
			current.targets = new Map();
			const elements: SnapshotElement[] = [];
			for (const element of document.querySelectorAll(candidates)) {
				const semantics = renderedSemantics(element);
				if (
					!(
						semantics.descriptor.role &&
						semantics.visible &&
						semantics.descriptor.enabled
					)
				) {
					continue;
				}
				const index = elements.length + 1;
				elements.push({ ...semantics.descriptor, index });
				current.targets.set(index, element);
			}
			return {
				documentToken: current.documentToken,
				elements,
				snapshotId: current.snapshotId,
				tabId,
				text: renderedText(document.body ?? current.root),
				title: document.title,
				truncated: false,
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
