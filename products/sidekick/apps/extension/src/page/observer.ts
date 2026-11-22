import { browser } from "wxt/browser";
import {
	createPageDispatcher,
	type PageActionExecutor,
	type PageDispatcher,
} from "./dispatch";
import { createSnapshotObserver, type SnapshotObserver } from "./snapshot";

interface ObserverWorld {
	__sidekickPageDispatcher?: PageDispatcher;
	__sidekickSnapshotObserver?: SnapshotObserver;
}

/** Re-injection reuses one observer/dispatcher/listener for this document. */
export function installSnapshotObserver(execute?: PageActionExecutor) {
	const world = globalThis as typeof globalThis & ObserverWorld;
	if (world.__sidekickSnapshotObserver) {
		return;
	}
	const observer = createSnapshotObserver(document);
	const dispatcher = createPageDispatcher(document, observer, execute);
	world.__sidekickSnapshotObserver = observer;
	world.__sidekickPageDispatcher = dispatcher;
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
			binding?: unknown;
			action?: unknown;
		};
		switch (request.type) {
			case "sidekick:observe":
				if (
					typeof request.tabId !== "number" ||
					!Number.isSafeInteger(request.tabId) ||
					request.tabId < 0
				) {
					return;
				}
				return Promise.resolve(dispatcher.observe(request.tabId));
			case "sidekick:bind-run":
				return Promise.resolve(dispatcher.bindRun(request.binding));
			case "sidekick:dispatch":
				return Promise.resolve(dispatcher.dispatch(request.action));
			default:
				return;
		}
	});
}
