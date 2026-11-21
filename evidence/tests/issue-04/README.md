# Caret issue #4 builder evidence

Builder checks were run on Linux in `/home/ubuntu/wt-04`. Unit APIs and foreground handles are injected fixtures. **No result here certifies Windows native behavior.**

## Passing checks

Unless otherwise specified, run from `products/caret`, with `export PATH=$HOME/.bun/bin:$PATH`.

| Exact command | Exit | Retained output |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | `install.log`: `Checked 1414 installs across 1560 packages (no changes)` |
| `bun test apps/desktop/tests/tray-hotkey.test.ts` | 0 | `tray-hotkey.log`: `18 pass`, `0 fail`, `74 expect() calls` |
| `bun run --cwd apps/desktop test:tray-hotkey` | 0 | `test-script.log`: `18 pass`, `0 fail`, `74 expect() calls` |
| `bun run --cwd apps/desktop typecheck` | 0 | `typecheck.log`: `$ tsc --noEmit -p tsconfig.json` |
| `bun run --cwd apps/desktop build` | 0 | `build.log`: production main/preload/renderer output; `✓ built in 181ms` |
| `bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types bun,node tests/tray-hotkey.test.ts` (from `products/caret/apps/desktop`) | 0 | `test-typecheck-desktop.log`: no diagnostics, `EXIT_CODE=0` |
| `bun run --cwd products/caret/apps/desktop verify:tray-secrets --against-main` (from repo root, after staging) | 0 | `secret-scan.log`: PR added-line credential-pattern check PASS |
| `git diff --cached --check` (from repo root) | 0 | `diff-check.log`: no diagnostics, `EXIT_CODE=0` |

Each command log contains its exit code. Build output was validated, then the generated tracked main bundle was restored to avoid a cross-builder generated-file conflict; source is the deliverable and `dev`/`build` rebuilds it.

A staged-diff secret-pattern scan and whitespace check are also run before committing; see `secret-scan.log` and `diff-check.log`. The secret scan checks OpenRouter/GitHub credential patterns and private keys without echoing matching content; it is not a comprehensive secret audit.

## Failed optional attempts, retained honestly

- From `products/caret`, `bunx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types bun,node apps/desktop/tests/tray-hotkey.test.ts` exited **1** (`test-typecheck.log`). TypeScript 6 requires `--ignoreConfig` when files are supplied.
- The same command with `--ignoreConfig` from `products/caret` exited **2** (`test-typecheck-corrected.log`): Node type definitions are workspace-local. Running from `apps/desktop` passed as recorded above.
- `bunx biome check apps/desktop/src/main/tray-hotkey.ts apps/desktop/src/main/tray-runtime.ts apps/desktop/src/main/tray-test-adapter.ts apps/desktop/tests/tray-hotkey.test.ts` exited **1** (`lint-initial.log`). The existing scaffold `biome.json:46` has the unknown `useTailwindSortedClasses` rule. Lint did not inspect code successfully; its configuration is deliberately not changed by issue #4.
- The first staged secret check exited **2** (`secret-scan-initial.log`): colorized Git output hid added-line prefixes. The scanner now forces `--no-color`, and the corrected scan passed.
- After committing, the default staged-only scan again exited **2** (`secret-scan-postcommit.log`) because there were no staged additions. The final `--against-main` mode rechecks committed and staged PR additions against `origin/main`, so it is reproducible after committing. A shell array exit-code capture attempt also produced a blank code; it was replaced by a rerun with direct exit-code capture.
- The first `git diff --cached --check` exited **2** (`diff-check-initial.log`) because Biome emitted trailing spaces in its diagnostic log. Retained logs have only trailing whitespace normalized; the final whitespace check passed. No diagnostic text or exit outcome was removed.

## NOT RUN: needs Windows

The issue's exact Windows command `bun run --cwd apps/desktop dev` (run twice) was not run on Windows. There is no attached Windows 11 desktop. Native single-instance process groups/tray counts; real fixed shortcut registration, conflict and unregister; Notepad foreground retention; actual setup close/minimize-to-tray; actual Cancel without setup activation; tray screenshot; and real payload-free foreground/event log are all **NOT RUN: needs Windows**.

`products/caret/apps/desktop/tests/tray-hotkey.windows.md` documents the opt-in Windows development adapter and the manual procedure. The adapter supplies fake readiness and callbacks but uses a real Windows foreground handle when run there. It does not implement microphone capture, key setup, or a session pipeline, and cannot enable recording in a packaged app.
