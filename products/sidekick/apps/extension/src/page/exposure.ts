const excludedTags = new Set([
	"iframe",
	"canvas",
	"object",
	"embed",
	"template",
	"noscript",
	"script",
	"style",
	"datalist",
]);

function isClosedDetailsBody(element: Element, node: Node): boolean {
	if (
		element.localName !== "details" ||
		element.hasAttribute("open") ||
		element === node
	) {
		return false;
	}
	const summary: Element | undefined = Array.from(element.children).find(
		(child) => child.localName === "summary"
	);
	return !summary?.contains(node);
}

/**
 * The sole exposure boundary for text, descriptors, and referenced labels.
 * Walk ancestor-or-self for every node, including Text: a closed details box
 * is rendered, but its direct body text is not. Only its first direct summary
 * (and that summary's descendants) is exposed through a closed details.
 * Never cache across observations: CSS/attributes/disclosure state can change.
 */
export function isExposed(node: Node | null): boolean {
	if (!node?.isConnected) {
		return false;
	}
	const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
	const view = node.ownerDocument?.defaultView;
	if (!(element && view)) {
		return false;
	}
	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		if (
			excludedTags.has(current.localName) ||
			(current.hasAttribute("hidden") &&
				current.getAttribute("hidden")?.toLowerCase() !== "until-found") ||
			current.hasAttribute("inert") ||
			current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true" ||
			(current.localName === "dialog" && !current.hasAttribute("open"))
		) {
			return false;
		}
		if (isClosedDetailsBody(current, node)) {
			return false;
		}
		// Inspect native render-skipping before computed styles/layout reads can
		// force a content-visibility:auto subtree to render as a side effect.
		if (
			typeof current.checkVisibility === "function" &&
			!current.checkVisibility({
				contentVisibilityAuto: true,
				opacityProperty: false,
				visibilityProperty: true,
			})
		) {
			return false;
		}
		const style = view.getComputedStyle(current);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.visibility === "collapse" ||
			style.contentVisibility === "hidden" ||
			style.opacity === "0"
		) {
			return false;
		}
	}
	return Array.from(element.getClientRects()).some(
		(rect) => rect.width > 0 && rect.height > 0
	);
}
