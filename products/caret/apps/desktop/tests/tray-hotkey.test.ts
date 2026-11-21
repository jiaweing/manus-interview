import { describe, expect, mock, test } from "bun:test";
import type {
  Readiness,
  SessionPhase,
  TrayHotkeyDependencies,
  TrayMenuItem,
  TrayStatus,
} from "../src/main/tray-hotkey";
import { startTrayHotkey, TOGGLE_SHORTCUT } from "../src/main/tray-hotkey";
import { createTrayTestAdapter } from "../src/main/tray-test-adapter";

function fixture(
  options: {
    lock?: boolean;
    registration?: boolean;
    registrationThrows?: boolean;
    readiness?: Readiness;
    pendingReady?: boolean;
  } = {}
) {
  const appListeners = new Map<string, () => void>();
  const windowListeners = new Map<
    string,
    (event: { preventDefault: () => void }) => void
  >();
  let shortcut: (() => void) | undefined;
  let menu: TrayMenuItem[] = [];
  let readiness: Readiness = options.readiness ?? {
    key: true,
    microphone: true,
  };
  let phase: SessionPhase = "idle";
  let releaseReady: () => void = () => {
    /* Intentional no-op in this fixture. */
  };
  const statuses: TrayStatus[] = [];
  const setup = {
    hide: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
    isMinimized: mock(() => false),
    on: mock(
      (
        event: "close" | "minimize",
        listener: (event: { preventDefault: () => void }) => void
      ) => {
        windowListeners.set(event, listener);
      }
    ),
    restore: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
    show: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
  };
  const tray = {
    destroy: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
    setContextMenu: mock((items: unknown) => {
      menu = items as TrayMenuItem[];
    }),
    setToolTip: mock((_text: string) => {
      /* Intentional no-op in this fixture. */
    }),
  };
  const ready = options.pendingReady
    ? new Promise<void>((resolve) => {
        releaseReady = resolve;
      })
    : Promise.resolve();
  const deps: TrayHotkeyDependencies = {
    app: {
      on: mock((event: "before-quit" | "will-quit", listener: () => void) => {
        appListeners.set(event, listener);
      }),
      quit: mock(() => {
        /* Intentional no-op in this fixture. */
      }),
      requestSingleInstanceLock: mock(() => options.lock ?? true),
      whenReady: mock(() => ready),
    },
    buildMenu: (items) => items,
    createSetupWindow: mock(() => setup),
    createTray: mock(() => tray),
    getReadiness: () => readiness,
    getSessionPhase: () => phase,
    globalShortcut: {
      register: mock((_accelerator: string, callback: () => void) => {
        shortcut = callback;
        if (options.registrationThrows) {
          throw new Error("platform details must not be logged");
        }
        return options.registration ?? true;
      }),
      unregister: mock((_accelerator: string) => {
        /* Intentional no-op in this fixture. */
      }),
    },
    onCancel: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
    onStatus: (status) => {
      statuses.push(status);
    },
    onToggle: mock(() => {
      /* Intentional no-op in this fixture. */
    }),
  };
  const lifecycle = startTrayHotkey(deps);
  return {
    activate: () => shortcut?.(),
    appEvent: (event: string) => appListeners.get(event)?.(),
    click: (label: string) =>
      menu.find((item) => item.label === label)?.click?.(),
    deps,
    labels: () => menu.map((item) => item.label),
    lifecycle,
    releaseReady,
    setPhase: (value: SessionPhase) => {
      phase = value;
    },
    setReadiness: (value: Readiness) => {
      readiness = value;
    },
    setup,
    statuses,
    tray,
    windowEvent: (event: string) => {
      const preventDefault = mock(() => {
        /* Intentional no-op in this fixture. */
      });
      windowListeners.get(event)?.({ preventDefault });
      return preventDefault;
    },
  };
}

describe("tray / fixed global hotkey — Linux injected fixtures, not Windows evidence", () => {
  test("second-instance exit: acquires lock before readiness and creates no tray/window", async () => {
    const first = fixture();
    await first.lifecycle.ready;
    const second = fixture({ lock: false });
    expect(await second.lifecycle.ready).toBe(false);
    expect(second.deps.app.quit).toHaveBeenCalledTimes(1);
    expect(second.deps.app.whenReady).not.toHaveBeenCalled();
    expect(second.deps.createSetupWindow).not.toHaveBeenCalled();
    expect(second.deps.createTray).not.toHaveBeenCalled();
    expect(second.deps.globalShortcut.register).not.toHaveBeenCalled();
    first.appEvent("second-instance");
    expect(first.setup.show).not.toHaveBeenCalled();
    expect(first.setup.restore).not.toHaveBeenCalled();
    expect(first.deps.createTray).toHaveBeenCalledTimes(1);
  });

  test("successful registration: only Control+Alt+Space toggles without showing setup", async () => {
    const f = fixture();
    expect(await f.lifecycle.ready).toBe(true);
    expect(f.deps.globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(f.deps.globalShortcut.register).toHaveBeenCalledWith(
      TOGGLE_SHORTCUT,
      expect.any(Function)
    );
    f.activate();
    expect(f.deps.onToggle).toHaveBeenCalledTimes(1);
    expect(f.setup.show).not.toHaveBeenCalled();
    expect(f.setup.restore).not.toHaveBeenCalled();
    expect(f.statuses.at(-1)).toEqual({ errors: [], ready: true });
  });

  for (const throws of [false, true]) {
    test(`conflicting registration${throws ? " (exception)" : ""}: exposes error and blocks start`, async () => {
      const f = fixture({ registration: false, registrationThrows: throws });
      await f.lifecycle.ready;
      f.activate();
      expect(f.deps.onToggle).not.toHaveBeenCalled();
      expect(f.statuses.at(-1)).toEqual({
        errors: ["shortcut_unavailable"],
        ready: false,
      });
      expect(f.labels()[0]).toContain("Ctrl+Alt+Space unavailable");
      f.lifecycle.dispose();
      expect(f.deps.globalShortcut.unregister).not.toHaveBeenCalled();
    });
  }

  for (const [name, readiness, errors] of [
    ["key", { key: false, microphone: true }, ["key_not_ready"]],
    ["microphone", { key: true, microphone: false }, ["microphone_not_ready"]],
    [
      "key and microphone",
      { key: false, microphone: false },
      ["key_not_ready", "microphone_not_ready"],
    ],
  ] as const) {
    test(`${name} readiness blocker: no start callback and corresponding error`, async () => {
      const f = fixture({ readiness });
      await f.lifecycle.ready;
      f.activate();
      expect(f.deps.onToggle).not.toHaveBeenCalled();
      expect(f.statuses.at(-1)).toEqual({ errors: [...errors], ready: false });
      expect(f.labels()[0]).toContain(
        name === "microphone"
          ? "Microphone not ready"
          : "Provider key not ready"
      );
    });
  }

  test("dynamic readiness is rechecked on activation and can be refreshed for tray display", async () => {
    const f = fixture();
    await f.lifecycle.ready;
    f.setReadiness({ key: false, microphone: true });
    f.activate();
    expect(f.deps.onToggle).not.toHaveBeenCalled();
    f.setReadiness({ key: true, microphone: true });
    expect(f.lifecycle.refreshReadiness()).toEqual({ errors: [], ready: true });
    f.activate();
    expect(f.deps.onToggle).toHaveBeenCalledTimes(1);
  });

  test("busy activation: non-recording work cannot start a parallel session", async () => {
    const f = fixture();
    await f.lifecycle.ready;
    f.setPhase("busy");
    f.activate();
    f.activate();
    expect(f.deps.onToggle).not.toHaveBeenCalled();
    expect(f.setup.show).not.toHaveBeenCalled();
  });

  test("recording activation calls the stop toggle even after key/microphone readiness is lost", async () => {
    const f = fixture();
    await f.lifecycle.ready;
    f.setPhase("recording");
    f.setReadiness({ key: false, microphone: false });
    f.activate();
    expect(f.deps.onToggle).toHaveBeenCalledTimes(1);
    expect(f.setup.show).not.toHaveBeenCalled();
  });

  test("tray Cancel calls cancellation without opening or restoring setup, even while blocked/busy", async () => {
    const f = fixture({ readiness: { key: false, microphone: false } });
    await f.lifecycle.ready;
    f.setPhase("busy");
    f.click("Cancel");
    expect(f.deps.onCancel).toHaveBeenCalledTimes(1);
    expect(f.setup.show).not.toHaveBeenCalled();
    expect(f.setup.restore).not.toHaveBeenCalled();
  });

  for (const event of ["close", "minimize"]) {
    test(`setup ${event} hides to tray rather than terminating`, async () => {
      const f = fixture();
      await f.lifecycle.ready;
      expect(f.windowEvent(event)).toHaveBeenCalledTimes(1);
      expect(f.setup.hide).toHaveBeenCalledTimes(1);
      expect(f.deps.app.quit).not.toHaveBeenCalled();
      expect(f.tray.destroy).not.toHaveBeenCalled();
    });
  }

  test("only explicit tray Setup restores and shows the existing setup window", async () => {
    const f = fixture();
    await f.lifecycle.ready;
    f.setup.isMinimized.mockReturnValue(true);
    f.click("Setup");
    expect(f.setup.restore).toHaveBeenCalledTimes(1);
    expect(f.setup.show).toHaveBeenCalledTimes(1);
    expect(f.deps.createSetupWindow).toHaveBeenCalledTimes(1);
  });

  test("shutdown unregister: releases only the owned shortcut and destroys tray exactly once", async () => {
    const f = fixture();
    await f.lifecycle.ready;
    f.click("Quit");
    expect(f.deps.app.quit).toHaveBeenCalledTimes(1);
    f.appEvent("before-quit");
    f.appEvent("will-quit");
    f.lifecycle.dispose();
    expect(f.deps.globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(f.deps.globalShortcut.unregister).toHaveBeenCalledWith(
      TOGGLE_SHORTCUT
    );
    expect(f.tray.destroy).toHaveBeenCalledTimes(1);
    f.activate();
    expect(f.deps.onToggle).not.toHaveBeenCalled();
    expect(f.windowEvent("close")).not.toHaveBeenCalled();
    expect(f.lifecycle.refreshReadiness().ready).toBe(false);
  });

  test("quit before app ready never creates a tray, window or shortcut", async () => {
    const f = fixture({ pendingReady: true });
    f.appEvent("before-quit");
    f.releaseReady();
    expect(await f.lifecycle.ready).toBe(false);
    expect(f.deps.createSetupWindow).not.toHaveBeenCalled();
    expect(f.deps.createTray).not.toHaveBeenCalled();
    expect(f.deps.globalShortcut.register).not.toHaveBeenCalled();
  });
});

describe("Windows development adapter — injected fixtures only", () => {
  test("disabled, Linux, and packaged paths cannot enable fixture readiness", () => {
    expect(
      createTrayTestAdapter({
        enabled: false,
        packaged: false,
        platform: "win32",
      })
    ).toBeUndefined();
    expect(
      createTrayTestAdapter({
        enabled: true,
        packaged: false,
        platform: "linux",
      })
    ).toBeUndefined();
    expect(
      createTrayTestAdapter({
        enabled: true,
        packaged: true,
        platform: "win32",
      })
    ).toBeUndefined();
  });

  test("opt-in adapter emits only bounded event metadata with injected handles; no capture", () => {
    const emit = mock((_event: unknown) => {
      /* Intentional no-op in this fixture. */
    });
    const hooks = createTrayTestAdapter({
      emit,
      enabled: true,
      packaged: false,
      platform: "win32",
      readForegroundHandle: () => "1234",
    });
    expect(hooks?.getReadiness()).toEqual({ key: true, microphone: true });
    hooks?.onToggle();
    expect(hooks?.getSessionPhase()).toBe("recording");
    expect(emit).toHaveBeenLastCalledWith({
      event: "toggle",
      fixture: true,
      foregroundAfter: "1234",
      foregroundBefore: "1234",
      phase: "recording",
    });
    hooks?.onToggle();
    expect(hooks?.getSessionPhase()).toBe("idle");
    hooks?.onToggle();
    hooks?.onCancel();
    expect(hooks?.getSessionPhase()).toBe("idle");
    expect(emit).toHaveBeenLastCalledWith({
      event: "cancel",
      fixture: true,
      foregroundAfter: "1234",
      foregroundBefore: "1234",
      phase: "idle",
    });
  });
});
