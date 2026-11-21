import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
	// Browser orchestration belongs in the visible panel, never this worker.
	browser.sidePanel
		.setPanelBehavior({ openPanelOnActionClick: true })
		.catch(() =>
			console.error("Sidekick could not configure the toolbar panel")
		);
});
