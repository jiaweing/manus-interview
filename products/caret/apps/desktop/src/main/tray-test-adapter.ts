import { execFileSync } from "node:child_process";
import type { TrayCallbacks } from "./tray-runtime";

interface TestAdapterOptions {
  platform: string;
  packaged: boolean;
  enabled: boolean;
  readForegroundHandle?: () => string;
  emit?: (event: { fixture: true; event: "toggle" | "cancel"; foregroundBefore: string; foregroundAfter: string; phase: "idle" | "recording" }) => void;
}

// Fixed test-only command: accepts no user text, keys, audio, or target contents.
const FOREGROUND_SCRIPT = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CaretForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'; [CaretForeground]::GetForegroundWindow().ToInt64().ToString()`;

function readWindowsForegroundHandle(): string {
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", FOREGROUND_SCRIPT], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^\d+$/.test(output) ? output : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Opt-in development fixture only; never opens a microphone or starts a real session. */
export function createTrayTestAdapter(options: TestAdapterOptions): TrayCallbacks | undefined {
  if (!options.enabled || options.packaged || options.platform !== "win32") return undefined;
  const readHandle = options.readForegroundHandle ?? readWindowsForegroundHandle;
  const emit = options.emit ?? ((event) => console.info(JSON.stringify(event)));
  let phase: "idle" | "recording" = "idle";
  function event(name: "toggle" | "cancel"): void {
    const foregroundBefore = readHandle();
    phase = name === "cancel" || phase === "recording" ? "idle" : "recording";
    emit({ fixture: true, event: name, foregroundBefore, foregroundAfter: readHandle(), phase });
  }
  return {
    getReadiness: () => ({ key: true, microphone: true }),
    getSessionPhase: () => phase,
    onToggle: () => event("toggle"),
    onCancel: () => event("cancel"),
  };
}
