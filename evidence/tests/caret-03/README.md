Closes #3

## Scope

Implement only Caret's renderer/preload security boundary. No key persistence, microphone capture, provider requests, helper execution, extra UI, or settings are added.

- A frozen `window.caret` facade exposes only `setupKey`, `subscribeStatus`, `cancel`, and `submitAudio`. No raw IPC, Node/process/filesystem, or helper-command capability is exposed.
- Main validates the registered WebContents, exact main frame, bundled file URL, operation, and exact payload schema before callbacks. Audio additionally requires an active matching session in main-owned `capture-complete` state, an explicitly allowed WebM MIME, and 1–10,000,000 bytes.
- Main loads bundled content only; renderer Node integration is disabled, isolation/sandbox enabled, webviews disabled, and navigation/redirects/new windows rejected. Diagnostics are fixed strings without URLs or payloads.
- New modules contain the logic; shared entrypoint/package changes are localized. `dev` builds the bundled UI before launch and deliberately does not use the renderer dev-server URL. Generated scaffold bundles were not included in this PR; build/dev regenerate them.
- The main-service integration seam is documented in `products/caret/apps/desktop/IPC-BOUNDARY.md`. Default services expose idle metadata and return `unavailable` until later issues install key/session callbacks; no feature is falsely reported as implemented.

## Verification actually run

Working directory: `products/caret`. Bun 1.4.5, Linux sandbox. Full outputs are committed under `evidence/tests/caret-03/`, with each command's exit code appended.

### `bun install --frozen-lockfile` — exit 0

Output tail (`install.txt`):

```text
Checked 1414 installs across 1560 packages (no changes) [5.24s]

EXIT_CODE=0
```

### `bun test apps/desktop/tests/ipc-boundary.test.ts` — exit 0

Output tail (`ipc-boundary-final.txt`):

```text
 101 pass
 0 fail
 222 expect() calls
Ran 101 tests across 1 file. [33.00ms]

EXIT_CODE=0
```

PASS cases cover all four permitted operations plus every tested invalid sender/schema/session/state/MIME/size case, preload capability restrictions/subscription cleanup, and navigation guard fixtures. These are unit fixtures, not real Windows desktop evidence.

### `bun run --cwd apps/desktop test:ipc-boundary` — exit 0

Output tail (`ipc-script.txt`):

```text
 101 pass
 0 fail
 222 expect() calls
Ran 101 tests across 1 file. [14.00ms]

EXIT_CODE=0
```

### `bun run --cwd apps/desktop typecheck` — final exit 0

Output (`typecheck-final.txt`):

```text
$ tsc --noEmit -p tsconfig.json

EXIT_CODE=0
```

The initial run exited 2 due to four implicit-any parameters in the frozen preload facade. The contextual-typing fix was applied and the command rerun successfully. The initial failed output is retained in `typecheck.txt`; no failed check is hidden.

### `bun run --cwd apps/desktop build` — exit 0

Output tail (`build-final.txt`):

```text
out/renderer/index.html                  0.35 kB
out/renderer/assets/index-DKor02y-.js  565.10 kB
✓ built in 138ms

EXIT_CODE=0
```

### `git diff --check` — exit 0

No diagnostics (`diff-check.txt`):

```text
EXIT_CODE=0
```

From the repository root, `git diff --cached --check` also passed with exit 0 (`diff-check-staged-final.txt`). Its first run exited 2 because captured test/lint output contained trailing whitespace; that diagnostic is retained in `diff-check-staged-initial.txt`. Only trailing spaces/tabs in evidence text files were normalized before committing; command output content and exit codes were preserved.

### `bun run ../../evidence/tests/caret-03/check-secrets.ts` — exit 0

Verification-only scan of staged changed files for known secret prefixes, private keys, and environment files. It prints only counts, never matches or contents. Full count/output: `secret-scan.txt`; final output tail:

```text
EXIT_CODE=0
```

### Scoped lint attempt — exit 1, blocked by pre-existing scaffold configuration

Exact command:

```sh
bunx biome check apps/desktop/src/main/ipc-boundary.ts apps/desktop/src/main/renderer-security.ts apps/desktop/src/main/register-ipc.ts apps/desktop/src/preload/caret-api.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/caret.d.ts apps/desktop/tests/ipc-boundary.test.ts
```

`lint-initial.txt` records `Found an unknown key useTailwindSortedClasses` at the existing `products/caret/biome.json:46`. Output tail:

```text
  × Biome exited because the configuration resulted in errors. Please fix them.

EXIT_CODE=1
```

The unrelated shared Biome configuration was deliberately not edited under this issue's scope fence. Lint did not run against the files and is not claimed as passed.

## NOT verified

- **NOT RUN: needs Windows** — `bun run --cwd apps/desktop dev`, then the issue's renderer DevTools checks (`typeof require`, `typeof process`, four exposed capabilities, external navigation, and `window.open`). No real Windows bundled-UI screenshot or blocked-navigation console capture is available. Linux fixture results and build output do not substitute for these checks.
- Real runtime sandbox/global isolation and bundled-window loading/navigation were not manually exercised on a desktop in this builder task.
- Independent clean-worktree verification has not been run by this builder; it belongs to the verifier.
- Scoped lint is blocked by the existing Biome configuration error above.

No merge was performed. Initial test/build outputs are also retained for audit (`ipc-boundary.txt`, `build.txt`).
