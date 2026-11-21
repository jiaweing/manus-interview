export const RENDERER_PRIVILEGES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
});

interface PreventableEvent {
  preventDefault(): void;
}

interface GuardedContents {
  on(
    event:
      | "will-navigate"
      | "will-frame-navigate"
      | "will-redirect"
      | "will-attach-webview",
    listener: (event: PreventableEvent) => void
  ): unknown;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
}

export function guardRenderer(
  contents: GuardedContents,
  log: (message: string) => void = console.info
): void {
  const blockNavigation = (event: PreventableEvent) => {
    event.preventDefault();
    // Static diagnostics only: URLs can contain user content or credentials.
    log("Caret: blocked navigation");
  };
  contents.on("will-navigate", blockNavigation);
  contents.on("will-frame-navigate", blockNavigation);
  contents.on("will-redirect", blockNavigation);
  contents.on("will-attach-webview", blockNavigation);
  contents.setWindowOpenHandler(() => {
    log("Caret: blocked new window");
    return { action: "deny" };
  });
}
