import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { createModelServices } from "./models/ipc-services";
import { createOverlayWindow } from "./overlay";
import { installOverlayFixture } from "./overlay-fixture";
import { registerCaretIpc } from "./register-ipc";
import { guardRenderer, RENDERER_PRIVILEGES } from "./renderer-security";
import { launchCaretTray } from "./tray-runtime";

let modelServices: ReturnType<typeof createModelServices> | undefined;

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
  modelServices ??= createModelServices(app.getPath("userData"));
  const models = modelServices;
  const boundary = registerCaretIpc(
    win.webContents,
    pathToFileURL(rendererPath).href,
    {
      getActiveSession: () => null,
      getStatus: () => ({ sessionId: null, state: "idle" }),
      ...models.services,
    }
  );
  win.once("closed", () => {
    models.manager.cancelAll();
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
