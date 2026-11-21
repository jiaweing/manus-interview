import { execFileSync } from "node:child_process";
import type { TrayCallbacks } from "./tray-runtime";

interface TestAdapterOptions {
  emit?: (event: {
    fixture: true;
    event: "toggle" | "cancel";
    foregroundBefore: string;
    foregroundAfter: string;
    phase: "idle" | "recording";
  }) => void;
  enabled: boolean;
  packaged: boolean;
  platform: string;
  readForegroundHandle?: () => string;
}

// Fixed test-only command: accepts no user text, keys, audio, or target contents.
const FOREGROUND_HANDLE_PATTERN = /^\d+$/;
const FOREGROUND_SCRIPT = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CaretForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'; [CaretForeground]::GetForegroundWindow().ToInt64().ToString()`;

function readWindowsForegroundHandle(): string {
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", FOREGROUND_SCRIPT],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
        windowsHide: true,
      }
    ).trim();
    return FOREGROUND_HANDLE_PATTERN.test(output) ? output : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Opt-in development fixture only; never opens a microphone or starts a real session. */
export function createTrayTestAdapter(
  options: TestAdapterOptions
): TrayCallbacks | undefined {
  if (!options.enabled || options.packaged || options.platform !== "win32") {
    return undefined;
  }
  const readHandle =
    options.readForegroundHandle ?? readWindowsForegroundHandle;
  const emit =
    options.emit ?? ((metadata) => console.info(JSON.stringify(metadata)));
  let phase: "idle" | "recording" = "idle";
  function event(name: "toggle" | "cancel"): void {
    const foregroundBefore = readHandle();
    phase = name === "cancel" || phase === "recording" ? "idle" : "recording";
    emit({
      event: name,
      fixture: true,
      foregroundAfter: readHandle(),
      foregroundBefore,
      phase,
    });
  }
  return {
    getReadiness: () => ({ key: true, microphone: true }),
    getSessionPhase: () => phase,
    onCancel: () => event("cancel"),
    onToggle: () => event("toggle"),
  };
}
