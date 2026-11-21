export const TOGGLE_SHORTCUT = "Control+Alt+Space";

export type SessionPhase = "idle" | "recording" | "busy";
export type ReadinessError =
  | "shortcut_unavailable"
  | "key_not_ready"
  | "microphone_not_ready";

export interface Readiness {
  key: boolean;
  microphone: boolean;
}

export interface TrayStatus {
  ready: boolean;
  errors: ReadinessError[];
}

interface PreventableEvent {
  preventDefault(): void;
}

export interface SetupWindowPort {
  on(event: "close" | "minimize", listener: (event: PreventableEvent) => void): unknown;
  hide(): void;
  show(): void;
  isMinimized(): boolean;
  restore(): void;
}

export interface TrayMenuItem {
  label: string;
  enabled?: boolean;
  click?: () => void;
}

export interface TrayPort {
  setToolTip(text: string): void;
  setContextMenu(menu: unknown): void;
  destroy(): void;
}

export interface TrayHotkeyDependencies {
  app: {
    requestSingleInstanceLock(): boolean;
    whenReady(): Promise<void>;
    on(event: "before-quit" | "will-quit", listener: () => void): unknown;
    quit(): void;
  };
  globalShortcut: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
  };
  createSetupWindow(): SetupWindowPort;
  createTray(): TrayPort;
  buildMenu(items: TrayMenuItem[]): unknown;
  getReadiness(): Readiness;
  getSessionPhase(): SessionPhase;
  onToggle(): void;
  onCancel(): void;
  onStatus?(status: TrayStatus): void;
}

export interface TrayHotkeyLifecycle {
  /** Resolves false for the secondary instance; it creates no windows or tray. */
  ready: Promise<boolean>;
  /** Call when the main-owned key or microphone readiness changes. */
  refreshReadiness(): TrayStatus;
  dispose(): void;
}

const ERROR_LABELS: Record<ReadinessError, string> = {
  shortcut_unavailable: "Ctrl+Alt+Space unavailable",
  key_not_ready: "Provider key not ready",
  microphone_not_ready: "Microphone not ready",
};

/** Main-process lifecycle only: no capture, IPC, provider, or session implementation. */
export function startTrayHotkey(deps: TrayHotkeyDependencies): TrayHotkeyLifecycle {
  let stopping = false;
  let registered = false;
  let tray: TrayPort | undefined;
  let setup: SetupWindowPort | undefined;

  function dispose(): void {
    stopping = true;
    if (registered) {
      deps.globalShortcut.unregister(TOGGLE_SHORTCUT);
      registered = false;
    }
    tray?.destroy();
    tray = undefined;
  }

  function refreshReadiness(): TrayStatus {
    const readiness = deps.getReadiness();
    const errors: ReadinessError[] = [];
    if (!registered) errors.push("shortcut_unavailable");
    if (!readiness.key) errors.push("key_not_ready");
    if (!readiness.microphone) errors.push("microphone_not_ready");
    const status = { ready: !stopping && errors.length === 0, errors };
    if (tray) {
      const label = errors.length ? errors.map((error) => ERROR_LABELS[error]).join("; ") : "Ready — Ctrl+Alt+Space";
      tray.setToolTip(`Caret — ${label}`);
      tray.setContextMenu(deps.buildMenu([
        { label, enabled: false },
        {
          label: "Setup",
          click: () => {
            if (stopping || !setup) return;
            if (setup.isMinimized()) setup.restore();
            setup.show();
          },
        },
        { label: "Cancel", click: () => { if (!stopping) deps.onCancel(); } },
        { label: "Quit", click: () => deps.app.quit() },
      ]));
    }
    deps.onStatus?.(status);
    return status;
  }

  function activate(): void {
    if (stopping || !registered) return;
    const phase = deps.getSessionPhase();
    // A busy transcription/cleanup/insertion must never spawn another session.
    if (phase === "busy") return;
    // Stopping existing capture must remain possible even if readiness was lost.
    if (phase === "recording" || refreshReadiness().ready) deps.onToggle();
  }

  // Acquire before whenReady, tray creation, window creation or shortcut registration.
  if (!deps.app.requestSingleInstanceLock()) {
    stopping = true;
    deps.app.quit();
    return { ready: Promise.resolve(false), refreshReadiness, dispose };
  }

  deps.app.on("before-quit", dispose);
  deps.app.on("will-quit", dispose);
  const ready = deps.app.whenReady().then(() => {
    if (stopping) return false;
    setup = deps.createSetupWindow();
    for (const event of ["close", "minimize"] as const) {
      setup.on(event, (closeEvent) => {
        if (stopping) return;
        closeEvent.preventDefault();
        setup?.hide();
      });
    }
    tray = deps.createTray();
    try {
      registered = deps.globalShortcut.register(TOGGLE_SHORTCUT, activate);
    } catch {
      // Surface the bounded error, not platform exceptions or sensitive payloads.
      registered = false;
    }
    refreshReadiness();
    return true;
  });
  return { ready, refreshReadiness, dispose };
}
