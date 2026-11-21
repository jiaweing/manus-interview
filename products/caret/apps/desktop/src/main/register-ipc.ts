import { ipcMain, type WebContents } from "electron";
import { IPC_REQUEST_CHANNEL, IPC_STATUS_CHANNEL } from "../shared/ipc-contract";
import {
  createIpcBoundary,
  isBundledUrl,
  publicStatus,
  type BoundaryServices,
} from "./ipc-boundary";

// Main-owned integration point. Key persistence and session lifecycle are later issues.
export function registerCaretIpc(
  contents: WebContents,
  rendererUrl: string,
  services: BoundaryServices = {
    getActiveSession: () => null,
    getStatus: () => ({ state: "idle", sessionId: null }),
  },
): { publishStatus(): void; dispose(): void } {
  const trusted = () => ({
    sender: contents,
    mainFrame: contents.mainFrame,
    url: rendererUrl,
  });
  const handle = createIpcBoundary(trusted, services);
  let subscribed = false;
  ipcMain.handle(IPC_REQUEST_CHANNEL, async (event, request: unknown) => {
    const result = await handle(event, request);
    if (result.ok && result.status) {
      subscribed = true;
    }
    return result;
  });
  return {
    publishStatus() {
      if (subscribed && !contents.isDestroyed() && isBundledUrl(contents.mainFrame.url, rendererUrl)) {
        contents.send(IPC_STATUS_CHANNEL, publicStatus(services.getStatus()));
      }
    },
    dispose() {
      subscribed = false;
      ipcMain.removeHandler(IPC_REQUEST_CHANNEL);
    },
  };
}
