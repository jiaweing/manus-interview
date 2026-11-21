export const MAX_SNAPSHOT_TEXT = 20_000;
export const MAX_SNAPSHOT_ELEMENTS = 300;
export const MAX_DESCRIPTOR_NAME = 2000;
const whitespace = /\s+/g;

const privateTextSelector =
	"input,textarea,select,[contenteditable]:not([contenteditable='false'])";
const privateRoles = new Set([
	"textbox",
	"searchbox",
	"combobox",
	"listbox",
	"option",
	"slider",
	"spinbutton",
]);
// Non-abstract ARIA roles: the first valid token wins, even when unsupported
// by our snapshot protocol. Unknown tokens are fallback candidates only.
const validRoles = new Set(
	(
		"alert alertdialog application article banner blockquote button caption cell " +
		"checkbox code columnheader combobox complementary contentinfo definition deletion " +
		"dialog directory document emphasis feed figure form generic grid gridcell group " +
		"heading img insertion link list listbox listitem log main mark marquee math menu " +
		"menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option " +
		"paragraph presentation progressbar radio radiogroup region row rowgroup rowheader " +
		"scrollbar search searchbox separator slider spinbutton status strong subscript " +
		"suggestion superscript switch tab table tablist tabpanel term textbox time timer " +
		"toolbar tooltip tree treegrid treeitem"
	).split(" ")
);

function roleTokens(element: Element): string[] {
	return normalizeText(element.getAttribute("role") ?? "")
		.toLowerCase()
		.split(" ");
}

export function explicitRole(element: Element): string | undefined {
	return roleTokens(element).find((role) => validRoles.has(role));
}

/** Any editable role token makes values private, regardless of role fallback. */
export function hasPrivateTextAncestor(element: Element | null): boolean {
	for (let current = element; current; current = current.parentElement) {
		if (
			current.matches(privateTextSelector) ||
			roleTokens(current).some((role) => privateRoles.has(role))
		) {
			return true;
		}
	}
	return false;
}

export function normalizeText(text: string): string {
	return text.replace(whitespace, " ").trim();
}

export function validateObservationQuery(query?: string): string | undefined {
	if (query === undefined) {
		return undefined;
	}
	if (typeof query !== "string" || query.length > 2000 || !query.trim()) {
		throw new Error(
			"Observation query must be nonblank and at most 2000 characters"
		);
	}
	return normalizeText(query);
}

/** Search the full permitted rendered text, not just its initial 20k excerpt. */
export function boundedText(text: string, query?: string) {
	if (query === undefined) {
		return {
			text: text.slice(0, MAX_SNAPSHOT_TEXT),
			truncated: text.length > MAX_SNAPSHOT_TEXT,
		};
	}
	const normalized = normalizeText(text);
	const haystack = normalized.toLowerCase();
	const needle = query.toLowerCase();
	const excerpts: string[] = [];
	let cursor = 0;
	let length = 0;
	while (length < MAX_SNAPSHOT_TEXT) {
		const match = haystack.indexOf(needle, cursor);
		if (match < 0) {
			break;
		}
		const start = Math.max(cursor, match - 200);
		const end = Math.min(normalized.length, match + query.length + 200);
		const separator = excerpts.length ? 1 : 0;
		const excerpt = normalized
			.slice(start, end)
			.slice(0, MAX_SNAPSHOT_TEXT - length - separator);
		excerpts.push(excerpt);
		length += excerpt.length + separator;
		cursor = end;
	}
	const result = excerpts.join("\n");
	return { text: result, truncated: result.length < normalized.length };
}

export interface LocalValueCheck {
	matches: boolean;
	status: "checked" | "unavailable";
}

/** Only a boolean leaves the content script; never return the actual value. */
export function checkControlValue(
	element: Element | null,
	expected: string
): LocalValueCheck {
	if (
		!element ||
		element.matches(
			"input[type='password'],input[type='hidden'],input[type='file']"
		)
	) {
		return { matches: false, status: "unavailable" };
	}
	if (element.matches("input,textarea,select")) {
		return {
			matches:
				(element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
					.value === expected,
			status: "checked",
		};
	}
	if (element.getAttribute("contenteditable") === "true") {
		return { matches: element.textContent === expected, status: "checked" };
	}
	return { matches: false, status: "unavailable" };
}
