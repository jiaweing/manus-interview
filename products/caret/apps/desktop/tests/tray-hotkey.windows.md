# Issue #4: tray / shortcut Windows verification

## Linux fixture checks

From `products/caret`:

```sh
bun install --frozen-lockfile
bun test apps/desktop/tests/tray-hotkey.test.ts
bun run --cwd apps/desktop test:tray-hotkey
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop build
```

The unit suite injects fake Electron APIs. It tests lock rejection, exactly one fixed registration, registration conflict/exception, each readiness blocker, busy rejection, recording-stop routing, setup close/minimize, explicit Setup, Cancel and shutdown. **These are control-flow fixtures, not Windows evidence.**

## Main integration seam

`launchCaretTray(createSetupWindow, callbacks)` accepts main-owned `getReadiness`, `getSessionPhase` (`idle`, `recording`, `busy`), `onToggle`, `onCancel`, and optional `onStatus` callbacks. The returned lifecycle's `refreshReadiness()` updates the tray status when key/microphone readiness changes. The normal scaffold starts with both readiness values false, so no recording can start. The later key, capture and session issues supply those hooks; this issue does not implement them.

The tray exposes a disabled readiness/error label, Setup, Cancel, and Quit. A shortcut conflict and missing key/microphone are exposed in the tray tooltip and status label, never in payload logs. Only explicit Setup shows/restores a window. A recording toggle may still stop capture after readiness is lost; readiness gates new starts. Non-recording busy work ignores the shortcut.

## Real Windows 11 check — NOT RUN: needs Windows

Use an actual Windows 11 desktop with Node (Electron's main-process runtime) and Bun installed. In a PowerShell terminal at `products/caret`:

```powershell
$env:CARET_TRAY_TEST_ADAPTER = "1"
bun run --cwd apps/desktop dev
```

Run the same command in a second terminal. The explicit adapter is available **only** on Windows, only in development (`app.isPackaged === false`), and only with that opt-in variable. It provides fixture readiness and toggle/cancel callbacks, not real capture or provider calls. Production ignores the variable.

1. Verify exactly one Caret Electron process group and one tray icon; the second instance exits without restoring or foregrounding setup. Electron normally has several processes in a single process group; the second dev server/CLI itself is not a second Caret instance.
2. Minimize setup, focus Notepad and press Ctrl+Alt+Space once. Verify Notepad stays foreground and setup stays hidden. The first terminal must contain exactly one `toggle` fixture event, with equal nonzero `foregroundBefore` and `foregroundAfter` handles and `phase: "recording"`. Press again to observe the idle/stop toggle.
3. The fixed test adapter snapshots the handle with a hidden, fixed PowerShell `GetForegroundWindow` call. It never reads window titles, text, audio or keys. `"unavailable"`, zero, unequal handles, or extra toggle events are **failed/unverified**, not a pass.
4. Exercise tray Cancel. Verify one `cancel` event, idle phase, no reopened setup. Tray menu interaction may itself change foreground; verify no Caret setup activation, rather than requiring the menu interaction to preserve Notepad's handle.
5. Use Setup explicitly to reopen the existing window; close it and verify Caret remains in the tray. Quit via tray and verify the tray disappears. Relaunch and verify the shortcut can register again.
6. To check a conflict, have another application reserve Ctrl+Alt+Space before launching Caret. Verify the tray status says `Ctrl+Alt+Space unavailable` and no toggle event occurs. Without the adapter, verify the missing provider-key and microphone status labels and blocked start.
7. Capture the real tray screenshot and the payload-free event/foreground log. Do not capture environment files or secrets. Retain both as Windows evidence; none has been captured in the Linux build.

Clear the development variable after checking:

```powershell
Remove-Item Env:CARET_TRAY_TEST_ADAPTER
```

Unverified here: native single-instance process/tray counts, shortcut registration/conflict/release, Notepad foreground preservation, setup minimize/close-to-tray and Cancel behavior, actual tray screenshot and real foreground/event log. **NOT RUN: needs Windows.**
