import { app, globalShortcut, Menu, nativeImage, Tray } from "electron";
import type { BrowserWindow } from "electron";
import { createTrayTestAdapter } from "./tray-test-adapter";
import { startTrayHotkey } from "./tray-hotkey";
import type { Readiness, SessionPhase, TrayStatus } from "./tray-hotkey";

export interface TrayCallbacks {
  getReadiness(): Readiness;
  getSessionPhase(): SessionPhase;
  onToggle(): void;
  onCancel(): void;
  onStatus?(status: TrayStatus): void;
}

// Embedded monochrome PNG avoids an unpackaged development-only asset path.
const TRAY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAaklEQVR4nO3SQQqAMBBD0d7/0kpXFlH6E3QqmMDsOs2jtLXkyFY8AQTwDKBnGWBMOeAqZYBzqYnwAHdlBkIHzEpEhAaglwsIDlCfF55nAPeXgz0NoJTDXQ5wysE+A7w4AQQQQAABfA/wz+wkvqWFqt/cWAAAAABJRU5ErkJggg==";

// Key/microphone and session ownership are integrated by their later issues.
// No readiness is fabricated in the normal application path.
const NOT_READY: TrayCallbacks = {
  getReadiness: () => ({ key: false, microphone: false }),
  getSessionPhase: () => "idle",
  onToggle: () => {},
  onCancel: () => {},
};

export function launchCaretTray(
  createSetupWindow: () => BrowserWindow,
  callbacks?: TrayCallbacks,
) {
  const hooks = callbacks ?? createTrayTestAdapter({
    platform: process.platform,
    packaged: app.isPackaged,
    enabled: process.env.CARET_TRAY_TEST_ADAPTER === "1",
  }) ?? NOT_READY;
  return startTrayHotkey({
    app,
    globalShortcut,
    createSetupWindow,
    createTray: () => {
      const tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
      return {
        setToolTip: (text) => tray.setToolTip(text),
        setContextMenu: (menu) => tray.setContextMenu(menu as Menu),
        destroy: () => tray.destroy(),
      };
    },
    buildMenu: (items) => Menu.buildFromTemplate(items),
    ...hooks,
  });
}
