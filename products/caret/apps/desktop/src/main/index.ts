import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOverlayWindow } from "./overlay";
import { installOverlayFixture } from "./overlay-fixture";
import { registerCaretIpc } from "./register-ipc";
import { guardRenderer, RENDERER_PRIVILEGES } from "./renderer-security";
import { launchCaretTray } from "./tray-runtime";

function createWindow(): BrowserWindow {
  const overlay = createOverlayWindow();
  const win = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      ...RENDERER_PRIVILEGES,
    },
  });
  const rendererPath = join(import.meta.dirname, "../renderer/index.html");
  guardRenderer(win.webContents);
  const boundary = registerCaretIpc(win.webContents, pathToFileURL(rendererPath).href);
  win.once("closed", () => {
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
  launchCaretTray(createWindow);
}
