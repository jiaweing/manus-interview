# Issue #133 — client invitations

Implemented only invitation creation/consumption and admission. The product root is `products/glassroom/` in the monorepo, adapting the issue's product-root paths. No server changes, login, handshake, WebRTC/chat implementation, storage, or reconnect mechanism were added.

## Acceptance criteria

- [x] **PASS — exact randomness and deliberate copy.** Browser-generated IDs decode to 16 bytes and secrets to 32 bytes, both canonical unpadded base64url. Independent rooms differ. The clipboard spy sees zero writes before the user's copy action; the native Chromium clipboard test also verifies no automatic copy and a correctly formed copied link.
- [x] **PASS — strip before signaling; no secret on the wire.** Joining replaces the current history entry, including malformed/missing invitations. The signaling constructor probe records `[true]` for fragment removal before the first `/signal` attempt. `requests.redacted.json` records actual HTTP/WSS URLs and actual signaling frames, asserts `secretAbsent: true`, and replaces the public room ID with `<room-id>`. Admission frames contain exactly operation, role, roomId, and version. No invitation or secret is passed to the Next route's server props.
- [x] **PASS — local missing/invalid errors.** Missing, empty, malformed, wrong-length, padded, duplicate, and noncanonical secrets fail locally. Invalid room IDs also fail locally. Browser checks record zero `/signal` constructors and zero HTTP/WSS `/signal` requests on these paths. Same-document fragment changes are scrubbed and validated locally as well.
- [x] **PASS — no login, third participant rejected.** Three isolated browser contexts exercise actual #132 admission. The outsider sees “Room full or unavailable”; both admitted peers remain present. No account/login controls exist.

Additional regressions prove Back/Forward never restores a consumed fragment, refresh cannot reconnect from the stripped URL, teardown removes the copy action, and pasting an old fragment into the ended creator does not initiate another admission. Browser storage checks find no cookies, local/session storage entries, IndexedDB databases, or service workers.

## Required screenshot evidence

- `products/glassroom/evidence/screens/133-joined-url.png`: actual headed Chromium address bar, fragment-free joined URL, and joined text state.
- `products/glassroom/evidence/screens/133-room-full-url.png`: actual rejected third Chromium profile with fragment-free URL and room-full label.
- `133-joined-page.png` and `133-room-full-page.png` in the same directory: corresponding page-only screenshots.

The screenshots were captured from an isolated Xvfb display with FFmpeg after Playwright brought the target profile forward. No test-control UI or generated screenshot annotations were shipped. Chromium's certificate warning is expected for the scaffold's self-signed development HTTPS certificate; `window.isSecureContext` and the boot regressions pass.

## Verification

Run from `products/glassroom` with Bun on PATH:

```sh
PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533 python3 evidence/issues/133/verify.py static
PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533 python3 evidence/issues/133/verify.py browser
```

The runner inherits the caller's `PUBLIC_PORT` and `NEXT_INTERNAL_PORT` (defaults 4133/5133 only when unset), including startup, readiness, and nested Playwright commands. It records each verbatim command, exit code, and last 15 output lines in this directory, redacting secret fragments and standalone 43-character base64url secrets before saving or printing. The browser stage starts its owned `bun run dev:https` stack, runs the issue's Playwright suite headed, and terminates only its own process group afterward. No Playwright HTML report or secret-bearing invitation trace is committed.

The initial implementation's single passing invitation run was insufficient: the independent verifier subsequently reproduced an invalid-to-missing state race. The fix round adds a deterministic replay regression and repeated dev/production verification; current commands, exit codes, output tails, and acceptance results are recorded in `fix-round/`. The original acceptance assertions have not been relaxed. The blocked-connectivity preflight intentionally reports a failed connection inside a passing fail-closed test; there is no relay/fallback.

## Fix-round root causes

1. A delayed/replayed `hashchange` re-read the already-scrubbed URL and overwrote the cached invalid verdict with missing. The handler now validates the event's still-current, nonempty fragment and retains the first verdict after scrubbing. Deterministic regressions cover stale-event replay and a genuinely corrected fragment.
2. A creator action can run before the initial React StrictMode effect cleanup (including hydration-replayed actions). Cleanup closed the CONNECTING socket, detached every callback, and left status connecting forever. The secret-free stress probe reproduced a close six milliseconds after construction, with no open event, join send, or second socket. A deterministic initial-effect creator action reproduced the same failure before the fix and passed afterward. Effect generations now cancel disposal during replay while real unmount remains terminal and pagehide disposes immediately. Admission disposal is exactly-once, ignores captured late callbacks/closing sockets, and turns send exceptions into terminal errors. The existing no-reconnect latch is never reset, so a room/secret is never reused. See `fix-round/lifecycle-proof.txt`.

The second failure was not dev-server first-compilation latency, duplicate server admission, or a rejected second creator. No expectation or test timeout was increased. Secret-bearing navigation errors and verifier output are redacted at their failure boundaries; the verifier honours caller-assigned ports.

Reproduce the required fix-round verification with `PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533 CHROMIUM_PATH=/usr/bin/chromium python3 evidence/issues/133/fix-round/gates.py` followed by the same environment and `python3 evidence/issues/133/fix-round/repeat.py`. The repeat runner rebuilds after stopping dev and before starting production, records each suite's last 15 lines and exit code, and stops only its own process group.

## Caveats / unverified

No #133 acceptance criterion is unverified. The optional root test check `bunx tsc --noEmit -p tsconfig.json` exits 2 because four pre-existing unchecked-index errors remain in unchanged `tests/unit/signaling-crypto.test.ts` from #128; see `root-test-types-known-failure.txt`. Both the mandatory product typecheck and the strict `noUncheckedIndexedAccess` typecheck for #133 tests pass. This issue does not verify future encrypted signaling, ECDH/WebRTC/chat integration, production security headers, or endpoint/clipboard/extension security guarantees.

#132 deliberately uses the same 1008 admission close for full and nonexistent rooms, so the client uses a combined full/unavailable label rather than inventing information. Admission status is not presented as verified identity. Secrets are held in client refs only, dropped on teardown, and never rendered. JavaScript cannot guarantee physical memory erasure.
