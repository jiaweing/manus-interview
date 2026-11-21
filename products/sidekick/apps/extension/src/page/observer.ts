import { browser } from "wxt/browser";
import { createSnapshotObserver, type SnapshotObserver } from "./snapshot";

interface ObserverWorld {
	__sidekickSnapshotObserver?: SnapshotObserver;
}

/** Re-injection reuses one observer/listener for the lifetime of this document. */
export function installSnapshotObserver() {
	const world = globalThis as typeof globalThis & ObserverWorld;
	if (world.__sidekickSnapshotObserver) {
		return;
	}
	const observer = createSnapshotObserver(document);
	world.__sidekickSnapshotObserver = observer;
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			sender.id !== browser.runtime.id ||
			!message ||
			typeof message !== "object"
		) {
			return;
		}
		const request = message as {
			type?: unknown;
			tabId?: unknown;
			query?: unknown;
		};
		if (
			request.type !== "sidekick:observe" ||
			typeof request.tabId !== "number" ||
			!Number.isInteger(request.tabId) ||
			request.tabId < 0 ||
			(request.query !== undefined &&
				(typeof request.query !== "string" ||
					!request.query.trim() ||
					request.query.length > 2000))
		) {
			return;
		}
		return Promise.resolve(
			observer.observe(request.tabId, request.query as string | undefined)
		);
	});
}
