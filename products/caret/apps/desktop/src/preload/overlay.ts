import { contextBridge, ipcRenderer } from "electron";
import {
	isOverlayState,
	OVERLAY_CHANNELS,
	type OverlayBridge,
	type OverlayUpdate,
} from "../shared/overlay-state";

const bridge: OverlayBridge = {
	onStatus(listener) {
		let active = true;
		let lastRevision = -1;
		const receive = (value: unknown) => {
			if (!(active && value) || typeof value !== "object") {
				return;
			}
			const candidate = value as Partial<OverlayUpdate>;
			if (
				!(
					isOverlayState(candidate.state) &&
					Number.isSafeInteger(candidate.revision)
				) ||
				typeof candidate.revision !== "number" ||
				candidate.revision <= lastRevision
			) {
				return;
			}
			lastRevision = candidate.revision;
			listener({ revision: candidate.revision, state: candidate.state });
		};
		const onUpdate = (_event: Electron.IpcRendererEvent, value: unknown) =>
			receive(value);
		ipcRenderer.on(OVERLAY_CHANNELS.status, onUpdate);
		// Subscribe before requesting the snapshot. Revisions prevent a late snapshot
		// from overwriting a newer status (including updates before renderer ready).
		ipcRenderer
			.invoke(OVERLAY_CHANNELS.snapshot)
			.then(receive)
			.catch(() => {
				// The window/handler can be disposed while a snapshot is in flight.
			});
		return () => {
			active = false;
			ipcRenderer.removeListener(OVERLAY_CHANNELS.status, onUpdate);
		};
	},
};

contextBridge.exposeInMainWorld("caretOverlay", bridge);
