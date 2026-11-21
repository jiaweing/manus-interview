import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import {
  isOverlayState,
  OVERLAY_CHANNELS,
  type OverlayState,
  type OverlayUpdate,
} from "../shared/overlay-state";

export const OVERLAY_SIZE = { height: 88, width: 304 } as const;

// Exposed for unit verification as well as the real BrowserWindow constructor.
export function overlayWindowOptions(preload: string) {
  return {
    ...OVERLAY_SIZE,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    focusable: false,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "Caret status",
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      devTools: !process.env.NODE_ENV || process.env.NODE_ENV !== "production",
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
  };
}

export interface OverlayController {
  dispose: () => void;
  hide: () => void;
  setStatus: (state: OverlayState) => void;
}

let activeOverlay: OverlayController | undefined;

export function updateOverlayStatus(state: OverlayState): void {
  if (!activeOverlay) {
    throw new Error("Overlay has not been initialized");
  }
  activeOverlay.setStatus(state);
}

export function createOverlayWindow(): OverlayController {
  if (activeOverlay) {
    return activeOverlay;
  }
  const win = new BrowserWindow(
    overlayWindowOptions(join(import.meta.dirname, "../preload/overlay.cjs"))
  );
  // Ignore clicks too: there are no interactive controls in a status-only overlay.
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, "floating");
  win.setFocusable(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  let update: OverlayUpdate = { revision: 0, state: "Starting" };
  let requestedVisible = false;
  let loaded = false;

  const position = () => {
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    );
    win.setPosition(
      Math.round(workArea.x + (workArea.width - OVERLAY_SIZE.width) / 2),
      Math.round(workArea.y + workArea.height - OVERLAY_SIZE.height - 24),
      false
    );
  };
  const publish = () => {
    if (!loaded || win.isDestroyed()) {
      return;
    }
    win.webContents.send(OVERLAY_CHANNELS.status, update);
    if (requestedVisible && !win.isVisible()) {
      position();
      // Never call show(), focus(), restore() or moveTop(): these can activate.
      win.showInactive();
    }
  };
  ipcMain.handle(OVERLAY_CHANNELS.snapshot, (event) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    ) {
      throw new Error("Invalid overlay sender");
    }
    return update;
  });
  win.webContents.on("did-finish-load", () => {
    loaded = true;
    publish();
  });
  const controller: OverlayController = {
    dispose() {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    },
    hide() {
      requestedVisible = false;
      if (!win.isDestroyed()) {
        win.hide();
      }
    },
    setStatus(state) {
      if (!isOverlayState(state)) {
        throw new Error("Invalid overlay state");
      }
      if (win.isDestroyed()) {
        throw new Error("Overlay has been disposed");
      }
      update = { revision: update.revision + 1, state };
      requestedVisible = true;
      publish();
    },
  };
  win.once("closed", () => {
    ipcMain.removeHandler(OVERLAY_CHANNELS.snapshot);
    activeOverlay = undefined;
  });
  activeOverlay = controller;
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(
      new URL("overlay.html", `${process.env.ELECTRON_RENDERER_URL}/`).href
    );
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/overlay.html"));
  }
  return controller;
}
