import { BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerCaretIpc } from "./register-ipc";
import { guardRenderer, RENDERER_PRIVILEGES } from "./renderer-security";
import { launchCaretTray } from "./tray-runtime";

function createWindow(): BrowserWindow {
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
  win.once("closed", () => boundary.dispose());
  win.once("ready-to-show", () => win.show());
  // Even development uses the bundled renderer, never an environment-provided URL.
  win.loadFile(rendererPath);
  return win;
}

launchCaretTray(createWindow);
