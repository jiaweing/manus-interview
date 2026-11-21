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

function isExplicitlyExcluded(element: Element, node: Node): boolean {
	return (
		excludedTags.has(element.localName) ||
		element.hasAttribute("hidden") ||
		element.hasAttribute("inert") ||
		element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true" ||
		(element.localName === "dialog" && !element.hasAttribute("open")) ||
		isClosedDetailsBody(element, node)
	);
}

function hasRenderedBoxText(
	node: Node,
	box: Element,
	contentVisibility: string
): boolean {
	if (node.nodeType !== 3 || contentVisibility !== "auto") {
		return true;
	}
	// checkVisibility tests skipped ANCESTORS, not the box's own contents.
	// Chromium can report an auto container's box visible while skipping its
	// direct text (also text through boxless wrappers). Native innerText on
	// that box is empty while skipped. Use it only as a local boolean gate;
	// never return it, mutate the DOM, or force text layout with Range/rects.
	const renderedText = (box as HTMLElement).innerText;
	return typeof renderedText === "string" && renderedText.length > 0;
}

/**
 * Shared observation/target-identity boundary for ordinary top-frame DOM.
 * Apply explicit exclusions to EVERY ancestor-or-self, but ask the browser
 * about the nearest box only: display:contents has no box of its own and must
 * not hide exposed descendants. Do not infer exposure from size/opacity/position.
 * No cross-observation cache: CSS, attributes and disclosure state are live.
 * Missing/throwing native state fails closed; no page content is read on error.
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
	try {
		let box: Element | undefined;
		let boxContentVisibility = "";
		for (
			let current: Element | null = element;
			current;
			current = current.parentElement
		) {
			if (isExplicitlyExcluded(current, node)) {
				return false;
			}
			// Read native render-skipping BEFORE computed styles can update a
			// skipped subtree. A false result is ignored only for display:contents.
			const rendered = box
				? undefined
				: current.checkVisibility?.({
						contentVisibilityAuto: true,
						visibilityProperty: true,
					});
			const style = view.getComputedStyle(current);
			if (
				style.display === "none" ||
				style.visibility === "hidden" ||
				style.visibility === "collapse" ||
				style.contentVisibility === "hidden"
			) {
				return false;
			}
			if (!box && style.display !== "contents") {
				if (rendered !== true) {
					return false;
				}
				box = current;
				boxContentVisibility = style.contentVisibility;
			}
		}
		return !!box && hasRenderedBoxText(node, box, boxContentVisibility);
	} catch {
		return false;
	}
}
