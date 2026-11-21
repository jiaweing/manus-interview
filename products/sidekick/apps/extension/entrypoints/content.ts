import { defineContentScript } from "wxt/utils/define-content-script";
import { installSnapshotObserver } from "../src/page/observer";

export default defineContentScript({
	allFrames: false,
	main() {
		if (window.top !== window) {
			throw new Error("Sidekick supports top-frame injection only");
		}
		installSnapshotObserver();
	},
	noScriptStartedPostMessage: true,
	// Omitting matches prevents WXT from granting required demo host permissions.
	registration: "runtime",
	world: "ISOLATED",
});
