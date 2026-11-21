import { contentScriptInjection } from "../utils/content-script";
import { optionalDemoOrigins } from "../utils/manifest";
import type { Snapshot } from "./page/snapshot";

export interface SnapshotBrowser {
	permissions: {
		contains: (permissions: { origins: string[] }) => Promise<boolean>;
		request: (permissions: { origins: string[] }) => Promise<boolean>;
	};
	scripting: {
		executeScript: (
			injection: ReturnType<typeof contentScriptInjection>
		) => Promise<unknown>;
	};
	tabs: {
		get: (tabId: number) => Promise<{ url?: string }>;
		sendMessage: (
			tabId: number,
			message: unknown,
			options: { frameId: number }
		) => Promise<unknown>;
	};
}

export interface AccessPause {
	canRequestAccess: boolean;
	message: string;
	origin?: string;
	reason: "permission-required" | "unsupported-page" | "injection-failed";
	status: "paused";
	tabId: number;
}

export type ObservationResult =
	| { status: "ready"; snapshot: Snapshot }
	| AccessPause;

export async function observeTab(
	tabId: number,
	api: SnapshotBrowser,
	query?: string
): Promise<ObservationResult> {
	try {
		const tab = await api.tabs.get(tabId);
		const url = new URL(tab.url ?? "");
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return {
				canRequestAccess: false,
				message:
					"Paused: Sidekick supports ordinary HTTP(S) pages, not browser pages, files, or PDFs.",
				reason: "unsupported-page",
				status: "paused",
				tabId,
			};
		}
		const origin = `${url.origin}/*`;
		if (!(await api.permissions.contains({ origins: [origin] }))) {
			const canRequestAccess = optionalDemoOrigins.includes(origin);
			return {
				canRequestAccess,
				message: canRequestAccess
					? `Paused: allow Sidekick to read ${url.origin} before observing this page.`
					: `Paused: Sidekick has no access to ${url.origin}. Only the configured demo origins can be granted.`,
				origin,
				reason: "permission-required",
				status: "paused",
				tabId,
			};
		}
		await api.scripting.executeScript(contentScriptInjection(tabId));
		const response = await api.tabs.sendMessage(
			tabId,
			{
				tabId,
				type: "sidekick:observe",
				...(query === undefined ? {} : { query }),
			},
			{ frameId: 0 }
		);
		const snapshot = response as Snapshot | undefined;
		if (
			!snapshot ||
			snapshot.tabId !== tabId ||
			!snapshot.snapshotId ||
			!snapshot.documentToken ||
			!Array.isArray(snapshot.elements)
		) {
			throw new Error("The page returned no valid snapshot");
		}
		return { snapshot, status: "ready" };
	} catch {
		return {
			canRequestAccess: false,
			message:
				"Paused: this tab could not be observed. It may have navigated, closed, or be a protected/unsupported page. Select an ordinary page and try again.",
			reason: "injection-failed",
			status: "paused",
			tabId,
		};
	}
}

/** Call directly in a click handler: do not await tab lookup before Chrome's request. */
export function requestOriginAccess(
	pause: AccessPause,
	api: SnapshotBrowser
): Promise<boolean> {
	if (
		pause.reason !== "permission-required" ||
		!pause.canRequestAccess ||
		!pause.origin ||
		!optionalDemoOrigins.includes(pause.origin)
	) {
		return Promise.resolve(false);
	}
	return api.permissions.request({ origins: [pause.origin] });
}
