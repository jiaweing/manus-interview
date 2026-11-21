import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
	allFrames: false,
	main() {
		if (window.top !== window) {
			throw new Error("Sidekick supports top-frame injection only");
		}
		// Snapshot handling is added separately; this entrypoint does not run an agent.
	},
	noScriptStartedPostMessage: true,
	// Omitting matches prevents WXT from granting required demo host permissions.
	registration: "runtime",
	world: "ISOLATED",
});
