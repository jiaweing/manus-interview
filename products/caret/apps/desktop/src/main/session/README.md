# Main-owned session hooks (#10)

`createSessionMachine` is framework-free. Production main connects only overlay/status emission and tray/IPC cancellation in this issue. Snapshot, capture, STT, cleanup and insertion defaults fail closed (capture release is an idempotent no-op while capture is unconnected). Normal tray readiness stays false until the actual readiness owners are connected. No microphone, provider request or paste implementation is included.

## Integration contract

One machine lives for the application lifetime. IDs combine a per-instance UUID prefix and a monotonic suffix; deterministic tests inject a prefix. The clock uses monotonic milliseconds and injectable timers. Tests can also inject AbortControllers.

1. Eligible tray activation calls `activate()`. Starting is emitted synchronously, before `snapshot(context)`. The snapshot's `Target` is copied and stays private to main.
2. A matching snapshot starts `startCapture(context)`. Resolving this request does **not** imply capture readiness. Issue #11 must call `captureReady(sessionId)` only when capture has actually started, or `failCapture(sessionId)` on a capture failure. Stale IDs and capture callbacks after the capture stage are rejected.
3. Listening activation or the cap (60 seconds after readiness) requests `stopCapture(context, "submit")` once. Main becomes `capture-complete` (busy), preserving the #3 IPC audio-validation contract. Issue #11/#14 connects the validated audio handoff to `submitAudio(submission)`; this main-only method assumes payload/MIME/size validation has already happened. The current IPC binding deliberately leaves audio and key operations unavailable.
4. Transcription and cleanup receive separate contexts and AbortSignals. They have absolute 15-second and 5-second deadlines, respectively. A response at the exact deadline loses even if the timer task has not run yet. There is no retry. The ports are provider-neutral, including Amendment A1's local adapters. Output validation and cleanup configuration belong to #12/#13/#14, not this machine.
5. The insertion hook receives the original captured target, session ID, cleaned text and its own AbortSignal. The machine issues at most one insertion request; only `paste_requested` produces Done (the existing overlay labels it “Paste requested,” not application acceptance). Inserting is busy public metadata, not a seventh overlay state; the overlay retains Cleaning while insertion is pending.
6. Cancel hides the overlay and exposes idle; failure exposes Error; success exposes Done. Every termination first invalidates the active ID, clears its timer/target reference, aborts the stage, and requests `stopCapture(context, "discard")`. Discard is required even after submit and must release the microphone despite an already-aborted signal. Adapter implementations must scope delayed release work to `context.sessionId`, never stop a later recording.

Ports must respect AbortSignal and guard their external side effects. The machine rejects all stale results even if a provider ignores cancellation, but cannot recall input already accepted outside the process. Inserting cancellation aborts the already-dispatched attempt and forbids subsequent advancement/attempts; a signal-honoring test adapter performs zero post-cancel insertions. Real helper cancellation, focus and clipboard safety remain Windows checks and #14 integration work.

An adapter's synchronous throw or promise rejection produces bounded Error metadata, releases capture, and never forwards diagnostics or payloads to the renderer/logs. Exceptions during terminal notifications/release are contained; capture release is requested, not claimed successful without the actual adapter.

## Verification

From `products/caret`: `bun test apps/desktop/tests/session-machine.test.ts`.

Equivalent named command: `bun run --cwd apps/desktop test:session`.

All current session tests are Linux fake-clock/fake-port evidence only. Windows hotkey/tray/focus/microphone/paste behavior is **UNVERIFIED: needs Windows**. The owner waived #9's ordering for BUILDING only; the native gate and all Windows criteria remain unchecked.
