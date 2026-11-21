# Issue #5 — six-state overlay evidence

## Scope and result

This change implements only the Starting, Listening, Transcribing, Cleaning, Done and Error status overlay and its verification harness. It does not implement recording, tray/hotkeys, native insertion, providers or the session state machine.

The main-only integration entry points are `createOverlayWindow()` and `updateOverlayStatus(state)` in `products/caret/apps/desktop/src/main/overlay.ts`. Creation keeps the window hidden; a main status update displays it using `showInactive()`. The returned controller also supports `hide()` and `dispose()`. No renderer can set status. The overlay has its own read-only, sender-checked preload, and status messages contain only a state and revision. Snapshot revisions prevent stale initial replies from overwriting newer status.

The window is configured as non-focusable, frameless, transparent, always-on-top, click-through and absent from the taskbar. No product code calls focus or forces a target application to reactivate. **These settings are implemented, but real Windows non-focus-stealing behavior is NOT VERIFIED.**

Done renders `Done` with `Paste requested`, not application acceptance. Inter 400/600 is bundled locally; no external font request is required. State is conveyed by labels, distinct icons and fill inversion. All twelve light/dark state samples have zero computed border/outline widths, a 10px radius, 14px text, and opacity/transform-only 150ms ease-out transitions. Minimum measured body-text contrast is 16.55:1. Emulated reduced motion produces 0s transitions and 0s animations.

## Commands and retained results

Working directory: `products/caret`. Bun is on PATH (`export PATH=$HOME/.bun/bin:$PATH`). Output logs retain complete output plus explicit exit codes.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | `install-output.txt` |
| `bun test apps/desktop/tests/overlay-state.test.ts` | 0 | `unit-output.txt`: nine tests, including six rendered state-to-label cases and the Done wording |
| `bun run --cwd apps/desktop typecheck` | 0 | `typecheck-output.txt` |
| `bun run --cwd apps/desktop typecheck:overlay` | 0 | `fixture-typecheck-output.txt`; covers fixture and test TypeScript too |
| `xvfb-run -a bun run --cwd apps/desktop fixture:overlay` | 0 | `fixture-output.txt`; runs the production build and actual Electron/Playwright fixture |
| `bun run --cwd apps/desktop verify:overlay-secrets` | 0 | `secret-check-output.txt`; run after staging the change |
| `bun run check` | 1 | `repository-lint-output.txt`; pre-existing root Biome configuration uses unsupported `useTailwindSortedClasses` |
| `git diff --cached --check` | 0 | `diff-check-output.txt` |

The secret check is a known-pattern check of added staged text for provider/GitHub keys and private-key headers. It never prints matched values. It is not a guarantee that arbitrary secrets cannot exist. All six light screenshots and representative dark screenshots were visually reviewed; the screenshots contain only static overlay status labels.

`linux-fixture-styles.json` contains actual computed style/window-configuration observations and contrast calculations. Root-level PNGs are the six light presentations; `dark/` contains their six dark presentations. They are captures of the running Electron renderer on **Linux/Xvfb**, not mockups and **not Windows evidence**.

Initial failed typecheck/radius checks are retained as `initial-typecheck-failed.txt`, `initial-fixture-failed.txt` and `initial-fixture-typecheck-failed.txt`. Missing CSS import types, a rem reference producing an 8.75px radius, and fixture-only Electron diagnostic typing were corrected before the final checks. Earlier supplementary lint diagnostics are also retained; they are not claimed as passes.

### Supplementary scoped lint (not a repository-lint pass)

An isolated copy of only this issue's overlay source, tests, fixture scripts and desktop manifest was checked using the root presets/config with **only** its unsupported `useTailwindSortedClasses` key removed. Isolation also avoids the inactive scaffold app's separate nested root config. The exact config used is retained in `scoped-biome-config.json`. From that temporary copy, `bunx biome check --write apps/desktop` exited 0 (`scoped-lint-output.txt`). Reviewed formatting fixes were applied to the actual overlay files. The shared root configuration was not changed, and `bun run check` still exits 1; this supplementary result must not be described as a full repository lint pass.

## Windows verification — NOT RUN: needs Windows

On a real Windows 11 desktop, from `products/caret`:

```sh
bun install --frozen-lockfile
bun test apps/desktop/tests/overlay-state.test.ts
bun run --cwd apps/desktop fixture:overlay
```

After the fixture prints its instruction, focus an editable Notepad control during the ten-second countdown and keep that same field active throughout the run. Do not open DevTools or interact with another application while collecting focus evidence. The unpackaged fixture uses main-process-only test controls, cycles all six real main statuses in light and dark presentations, checks computed styles and reduced motion, and exercises hide/re-show. The overlay itself has no interactive test controls and never needs focus.

On Windows, `scripts/overlay-focus.ps1` uses real `GetForegroundWindow`, `GetWindowThreadProcessId` and `GetGUIThreadInfo` calls. The fixture requires nonzero foreground/focused-control handles and a Notepad baseline. It compares the baseline and the before/after handles at every normal transition, reduced-motion update and hide/re-show. It writes the real measurements to `evidence/overlay/windows-handles.json`, Windows style observations to `windows-styles.json`, and captures the state screenshots. Partial observed handle records are preserved if a later assertion fails. No handles are mocked on Linux and no Windows handle log has been fabricated.

Not verified in this task: real Windows foreground/focused-control invariance; Windows taskbar/always-on-top/click-through behavior; Windows screenshots/style/reduced-motion results; the PowerShell probe's execution on Windows. The issue's Windows acceptance criterion remains open for a Windows verifier. Full-product, packaged, provider and native insertion gates belong to other issues and were not run here.
