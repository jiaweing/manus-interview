import type { BrowserWindow } from "electron";
import { app, globalShortcut, Menu, nativeImage, Tray } from "electron";
import type { Readiness, SessionPhase, TrayStatus } from "./tray-hotkey";
import { startTrayHotkey } from "./tray-hotkey";
import { createTrayTestAdapter } from "./tray-test-adapter";

export interface TrayCallbacks {
  getReadiness: () => Readiness;
  getSessionPhase: () => SessionPhase;
  onCancel: () => void;
  onStatus?: (status: TrayStatus) => void;
  onToggle: () => void;
}

// Embedded monochrome PNG avoids an unpackaged development-only asset path.
const TRAY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAaklEQVR4nO3SQQqAMBBD0d7/0kpXFlH6E3QqmMDsOs2jtLXkyFY8AQTwDKBnGWBMOeAqZYBzqYnwAHdlBkIHzEpEhAaglwsIDlCfF55nAPeXgz0NoJTDXQ5wysE+A7w4AQQQQAABfA/wz+wkvqWFqt/cWAAAAABJRU5ErkJggg==";

// Key/microphone and session ownership are integrated by their later issues.
// No readiness is fabricated in the normal application path.
const NOT_READY: TrayCallbacks = {
  getReadiness: () => ({ key: false, microphone: false }),
  getSessionPhase: () => "idle",
  onCancel: () => {
    /* No session integration is installed yet. */
  },
  onToggle: () => {
    /* No session integration is installed yet. */
  },
};

export function launchCaretTray(
  createSetupWindow: () => BrowserWindow,
  callbacks?: TrayCallbacks
) {
  const hooks =
    callbacks ??
    createTrayTestAdapter({
      enabled: process.env.CARET_TRAY_TEST_ADAPTER === "1",
      packaged: app.isPackaged,
      platform: process.platform,
    }) ??
    NOT_READY;
  return startTrayHotkey({
    app,
    buildMenu: (items) => Menu.buildFromTemplate(items),
    createSetupWindow,
    createTray: () => {
      const tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
      return {
        destroy: () => tray.destroy(),
        setContextMenu: (menu) => tray.setContextMenu(menu as Menu),
        setToolTip: (text) => tray.setToolTip(text),
      };
    },
    globalShortcut,
    ...hooks,
  });
}
