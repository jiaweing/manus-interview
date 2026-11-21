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
  errors: ReadinessError[];
  ready: boolean;
}

interface PreventableEvent {
  preventDefault(): void;
}

export interface SetupWindowPort {
  hide(): void;
  isMinimized(): boolean;
  on(
    event: "close" | "minimize",
    listener: (event: PreventableEvent) => void
  ): unknown;
  restore(): void;
  show(): void;
}

export interface TrayMenuItem {
  click?: () => void;
  enabled?: boolean;
  label: string;
}

export interface TrayPort {
  destroy(): void;
  setContextMenu(menu: unknown): void;
  setToolTip(text: string): void;
}

export interface TrayHotkeyDependencies {
  app: {
    requestSingleInstanceLock(): boolean;
    whenReady(): Promise<void>;
    on(event: "before-quit" | "will-quit", listener: () => void): unknown;
    quit(): void;
  };
  buildMenu(items: TrayMenuItem[]): unknown;
  createSetupWindow(): SetupWindowPort;
  createTray(): TrayPort;
  getReadiness(): Readiness;
  getSessionPhase(): SessionPhase;
  globalShortcut: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
  };
  onCancel(): void;
  onStatus?(status: TrayStatus): void;
  onToggle(): void;
}

export interface TrayHotkeyLifecycle {
  dispose(): void;
  /** Resolves false for the secondary instance; it creates no windows or tray. */
  ready: Promise<boolean>;
  /** Call when the main-owned key or microphone readiness changes. */
  refreshReadiness(): TrayStatus;
}

const ERROR_LABELS: Record<ReadinessError, string> = {
  key_not_ready: "Provider key not ready",
  microphone_not_ready: "Microphone not ready",
  shortcut_unavailable: "Ctrl+Alt+Space unavailable",
};

/** Main-process lifecycle only: no capture, IPC, provider, or session implementation. */
export function startTrayHotkey(
  deps: TrayHotkeyDependencies
): TrayHotkeyLifecycle {
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
    if (!registered) {
      errors.push("shortcut_unavailable");
    }
    if (!readiness.key) {
      errors.push("key_not_ready");
    }
    if (!readiness.microphone) {
      errors.push("microphone_not_ready");
    }
    const status = { errors, ready: !stopping && errors.length === 0 };
    if (tray) {
      const label = errors.length
        ? errors.map((error) => ERROR_LABELS[error]).join("; ")
        : "Ready — Ctrl+Alt+Space";
      tray.setToolTip(`Caret — ${label}`);
      tray.setContextMenu(
        deps.buildMenu([
          { enabled: false, label },
          {
            click: () => {
              if (stopping || !setup) {
                return;
              }
              if (setup.isMinimized()) {
                setup.restore();
              }
              setup.show();
            },
            label: "Setup",
          },
          {
            click: () => {
              if (!stopping) {
                deps.onCancel();
              }
            },
            label: "Cancel",
          },
          { click: () => deps.app.quit(), label: "Quit" },
        ])
      );
    }
    deps.onStatus?.(status);
    return status;
  }

  function activate(): void {
    if (stopping || !registered) {
      return;
    }
    const phase = deps.getSessionPhase();
    // A busy transcription/cleanup/insertion must never spawn another session.
    if (phase === "busy") {
      return;
    }
    // Stopping existing capture must remain possible even if readiness was lost.
    if (phase === "recording" || refreshReadiness().ready) {
      deps.onToggle();
    }
  }

  // Acquire before whenReady, tray creation, window creation or shortcut registration.
  if (!deps.app.requestSingleInstanceLock()) {
    stopping = true;
    deps.app.quit();
    return { dispose, ready: Promise.resolve(false), refreshReadiness };
  }

  deps.app.on("before-quit", dispose);
  deps.app.on("will-quit", dispose);
  const ready = deps.app.whenReady().then(() => {
    if (stopping) {
      return false;
    }
    setup = deps.createSetupWindow();
    for (const event of ["close", "minimize"] as const) {
      setup.on(event, (closeEvent) => {
        if (stopping) {
          return;
        }
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
  return { dispose, ready, refreshReadiness };
}
