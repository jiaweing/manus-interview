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
python3 evidence/issues/133/verify.py static
python3 evidence/issues/133/verify.py browser
```

The runner records each verbatim command, exit code, and last 15 output lines in this directory. The browser stage starts the owned `bun run dev:https` stack on `PUBLIC_PORT=4133 NEXT_INTERNAL_PORT=5133`, waits for readiness, runs the issue's Playwright suite headed, and terminates only its own process group afterward. No Playwright HTML report or secret-bearing invitation trace is committed.

All mandatory protocol gates **PASS (exit 0)**: fetch/merge main, frozen install, Biome fix, `bun run check`, `bun run check-types`, `bun run build`, `bun test tests/unit` (**44 passed**), invitation Playwright (**9 passed**, including all six issue-named cases), and relevant existing boot/preflight/server Playwright (**8 passed**). The strict isolated invitation test TypeScript check and `git diff --check` also pass. The blocked-connectivity preflight intentionally reports a failed connection inside a passing fail-closed test; there is no relay/fallback.

## Caveats / unverified

No #133 acceptance criterion is unverified. The optional root test check `bunx tsc --noEmit -p tsconfig.json` exits 2 because four pre-existing unchecked-index errors remain in unchanged `tests/unit/signaling-crypto.test.ts` from #128; see `root-test-types-known-failure.txt`. Both the mandatory product typecheck and the strict `noUncheckedIndexedAccess` typecheck for #133 tests pass. This issue does not verify future encrypted signaling, ECDH/WebRTC/chat integration, production security headers, or endpoint/clipboard/extension security guarantees.

#132 deliberately uses the same 1008 admission close for full and nonexistent rooms, so the client uses a combined full/unavailable label rather than inventing information. Admission status is not presented as verified identity. Secrets are held in client refs only, dropped on teardown, and never rendered. JavaScript cannot guarantee physical memory erasure.
