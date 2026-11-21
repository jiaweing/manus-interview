import { useCallback, useState } from "react";
import { browser } from "wxt/browser";
import {
	type ObservationResult,
	observeTab,
	requestOriginAccess,
	type SnapshotBrowser,
} from "../snapshot-client";
import "./page-observer.css";

// WXT's public-path type requires a leading slash; Chrome also supports the
// relative packaged path in #77's existing, tested descriptor.
const snapshotBrowser: SnapshotBrowser = {
	permissions: browser.permissions,
	scripting: {
		executeScript: browser.scripting
			.executeScript as SnapshotBrowser["scripting"]["executeScript"],
	},
	tabs: browser.tabs,
};
/** Read-only grounding control; the run loop can consume observeTab separately. */
export function PageObserver() {
	const [result, setResult] = useState<ObservationResult | undefined>(
		undefined
	);
	const [busy, setBusy] = useState(false);
	const observeSelectedTab = useCallback(async () => {
		setBusy(true);
		try {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (tab?.id === undefined) {
				setResult({
					canRequestAccess: false,
					message: "Paused: select an ordinary HTTP(S) tab to observe.",
					reason: "unsupported-page",
					status: "paused",
					tabId: -1,
				});
				return;
			}
			setResult(await observeTab(tab.id, snapshotBrowser));
		} finally {
			setBusy(false);
		}
	}, []);
	const allowOrigin = useCallback(() => {
		if (result?.status !== "paused") {
			return;
		}
		const pause = result;
		// Chrome requires request() to be called synchronously in this user gesture.
		const request = requestOriginAccess(pause, snapshotBrowser);
		setBusy(true);
		request
			.then(async (granted) => {
				if (granted) {
					setResult(await observeTab(pause.tabId, snapshotBrowser));
				} else {
					setResult({
						...pause,
						message:
							"Paused: page access was not granted. No snapshot was captured. You can allow access or select another tab.",
					});
				}
			})
			.catch(() => {
				setResult({
					...pause,
					message:
						"Paused: Chrome could not request page access. Try again from the Allow access button.",
				});
			})
			.finally(() => {
				setBusy(false);
			});
	}, [result]);
	return (
		<section aria-label="Page observation" className="page-observer">
			<button disabled={busy} onClick={observeSelectedTab} type="button">
				{busy ? "Observing page…" : "Observe page"}
			</button>
			<div aria-live="polite" role="status">
				{result?.status === "paused" && <p>{result.message}</p>}
				{result?.status === "ready" && (
					<p>
						Observed {result.snapshot.title}: {result.snapshot.elements.length}{" "}
						indexed elements.
					</p>
				)}
			</div>
			{result?.status === "paused" && result.canRequestAccess && (
				<button disabled={busy} onClick={allowOrigin} type="button">
					Allow access to {new URL(result.origin ?? "").hostname}
				</button>
			)}
		</section>
	);
}
