import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { createOverlayWindow } from "./overlay";
import { installOverlayFixture } from "./overlay-fixture";
import { registerCaretIpc } from "./register-ipc";
import { guardRenderer, RENDERER_PRIVILEGES } from "./renderer-security";
import {
  sessionBoundaryServices,
  sessionTrayCallbacks,
} from "./session/bindings";
import { createSessionMachine } from "./session/machine";
import { launchCaretTray } from "./tray-runtime";
import { createTrayTestAdapter } from "./tray-test-adapter";

let publishSessionStatus: (() => void) | undefined;
const session = createSessionMachine({
  ports: {
    emitOverlay: (state) => createOverlayWindow().setStatus(state),
    emitStatus: () => publishSessionStatus?.(),
    hideOverlay: () => createOverlayWindow().hide(),
  },
});

function createWindow(): BrowserWindow {
  const overlay = createOverlayWindow();
  const win = new BrowserWindow({
    height: 320,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      ...RENDERER_PRIVILEGES,
    },
    width: 480,
  });
  const rendererPath = join(import.meta.dirname, "../renderer/index.html");
  guardRenderer(win.webContents);
  const boundary = registerCaretIpc(
    win.webContents,
    pathToFileURL(rendererPath).href,
    sessionBoundaryServices(session)
  );
  publishSessionStatus = boundary.publishStatus;
  win.once("closed", () => {
    session.cancel();
    publishSessionStatus = undefined;
    boundary.dispose();
    overlay.dispose();
  });
  win.once("ready-to-show", () => win.show());
  // Even development uses the bundled renderer, never an environment-provided URL.
  win.loadFile(rendererPath);
  return win;
}

if (!app.isPackaged && process.argv.includes("--fixture-overlay")) {
  app.whenReady().then(installOverlayFixture);
  app.on("window-all-closed", () => app.quit());
} else {
  app.on("before-quit", () => session.cancel());
  // Preserve the explicit Windows-only #4 fixture; never fabricate readiness
  // in the normal app path while #11/#15 are still unconnected.
  const callbacks =
    createTrayTestAdapter({
      enabled: process.env.CARET_TRAY_TEST_ADAPTER === "1",
      packaged: app.isPackaged,
      platform: process.platform,
    }) ?? sessionTrayCallbacks(session);
  launchCaretTray(createWindow, callbacks);
}
