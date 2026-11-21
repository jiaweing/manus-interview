import { BrowserWindow, app } from "electron";
import { join } from "node:path";
// src/main/index.ts
function createWindow() {
	const win = new BrowserWindow({
		width: 480,
		height: 320,
		show: false,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});
	win.once("ready-to-show", () => win.show());
	if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
export {};
