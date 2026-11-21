import { createOverlayWindow, type OverlayController } from "./overlay";

declare global {
  // This is never exposed over IPC or to the production renderer.
  var caretOverlayFixture: OverlayController | undefined;
}

export function installOverlayFixture(): void {
  globalThis.caretOverlayFixture = createOverlayWindow();
}
