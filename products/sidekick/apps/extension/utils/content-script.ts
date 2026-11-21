// Pass this descriptor to browser.scripting.executeScript from the visible panel
// only after activeTab access or an explicit origin permission has been granted.
export function contentScriptInjection(tabId: number) {
	return {
		files: ["content-scripts/content.js"],
		target: { frameIds: [0], tabId },
		world: "ISOLATED" as const,
	};
}
