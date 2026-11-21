# Renderer IPC boundary (#3)

The bundled renderer receives exactly four capabilities under `window.caret`. It does not receive Electron IPC, Node, process, filesystem, or native-helper access. Main runs on Electron's Node runtime; Bun is used for tooling and tests.

| Capability | Input | Result |
| --- | --- | --- |
| `setupKey(key)` | Nonblank string, at most 4096 characters | Acknowledgment or a static error code; never returns the key |
| `subscribeStatus(listener)` | Callback taking `{ state, sessionId }` | Unsubscribe function; initial snapshot and subsequent main-published updates |
| `cancel(sessionId)` | Active matching session ID | Acknowledgment or a static error code |
| `submitAudio({ sessionId, mimeType, audio })` | Matching active session in main-owned `capture-complete` state; `audio/webm` or `audio/webm;codecs=opus`; nonempty `ArrayBuffer` at most `10_000_000` bytes (10 MB) | Acknowledgment or a static error code |

Session IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. Request envelopes and payloads have exact schemas; additional fields, including renderer-supplied state or target handles, are rejected. Sender validation requires the registered WebContents, its main frame, and the exact bundled file URL (same-document fragments are allowed). Unknown operations have no dispatch path. Failed callbacks return only `operation_failed`, never an exception message.

## Integration for later issues

`registerCaretIpc(webContents, bundledRendererUrl, services)` connects main-owned `getActiveSession`, `getStatus`, `setupKey`, `cancel`, and `submitAudio` callbacks. Its `publishStatus()` sends metadata only; `dispose()` unregisters the handler on window closure. Callback implementations must enforce their own session lifecycle across asynchronous work; this boundary validates at dispatch, without implementing the later session-state-machine issue.

The default services expose idle status and fail closed for key setup, cancellation, and audio submission. This issue does **not** persist keys, create sessions, capture microphone audio, call providers, or invoke a helper. Those features belong to their assigned issues. No UI was added.

## Bundled-only development

From `products/caret`:

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop dev
```

The dev script builds the renderer first. Main always loads `out/renderer/index.html` with `loadFile`; the Electron-Vite renderer-server URL is deliberately unused. Renderer hot reload is therefore not active: restart dev to rebuild renderer changes. Main and preload retain Electron-Vite's normal development behavior. Navigation (including subframes and redirects), attached webviews, and new windows are blocked. The existing bundled HTML CSP allows local resources only.

## Linux checks

```sh
bun test apps/desktop/tests/ipc-boundary.test.ts
bun run --cwd apps/desktop test:ipc-boundary
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop build
```

Fixture tests cover all four operations, sender and exact-schema rejection, missing/mismatching sessions, every non-capture-complete state, MIME and size boundaries, metadata-only status, preload subscription disposal, and navigation guard callbacks. These fixtures and the build are **not** evidence of real Windows behavior.

## Windows acceptance check — NOT RUN: needs Windows

On a real Windows desktop run `bun run --cwd apps/desktop dev`. In renderer DevTools evaluate:

```js
typeof require // expected: "undefined"
typeof process // expected: "undefined"
Object.keys(window.caret).sort()
// expected: ["cancel", "setupKey", "submitAudio", "subscribeStatus"]
window.open("https://example.com") // expected: no extra window
location.href = "https://example.com" // expected: bundled UI remains loaded
```

Capture the console output and main's fixed `Caret: blocked navigation` / `Caret: blocked new window` messages, without keys or payloads. The bundled UI loading, real runtime globals, and real navigation/new-window behavior require this check; Linux fixtures do not certify them.
