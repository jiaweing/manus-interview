# Issue #131 verification commands

Run in `products/glassroom` on branch `glassroom/131-crypto-invariants`.

Environment: `PATH=$HOME/.bun/bin:$PATH PUBLIC_PORT=4131 NEXT_INTERNAL_PORT=5131`.

## merge-main

Command: `git fetch origin && git merge origin/main`

Exit code: **0**

```text
 create mode 100644 products/flopside/evidence/i33/rebase.log
 create mode 100644 products/flopside/evidence/i33/test.log
 create mode 100644 products/flopside/evidence/i33/typecheck.log
 create mode 100644 products/flopside/packages/engine/deadline.test.ts
 create mode 100644 products/flopside/packages/engine/deadline.ts
 create mode 100644 products/session-seven/apps/video/tests/glassroom.test.js
 create mode 100644 products/session-seven/qa/glassroom-full-suite.txt
 create mode 100644 products/session-seven/qa/glassroom-review.md
 create mode 100644 products/session-seven/qa/glassroom-tests.txt
 create mode 100644 products/session-seven/qa/glassroom-verification.txt
 create mode 100644 products/session-seven/qa/stills/glassroom/frame-1380.png
 create mode 100644 products/session-seven/qa/stills/glassroom/frame-1410.png
 create mode 100644 products/session-seven/qa/stills/glassroom/frame-1500.png
 create mode 100644 products/session-seven/qa/stills/glassroom/frame-1590.png
 create mode 100644 products/session-seven/qa/stills/glassroom/frame-1619.png
```

Verified base after merge: `506ef6522a272f9ea2d7dd4a9c2573ca5815543a`.

## install

Command: `bun install --frozen-lockfile`

Exit code: **0**

```text
bun install v1.4.5 (a7733435c)

Checked 327 installs across 393 packages (no changes) [131.00ms]
```

## check

Command: `bun run check`

Exit code: **0**

```text
$ ultracite check
Checked 55 files in 369ms. No fixes applied.
```

## check-types

Command: `bun run check-types`

Exit code: **0**

```text
   • Packages in scope: @glassroom/config, @glassroom/ui, server, web
   • Running check-types in 4 packages
   • Remote caching disabled, using shared worktree cache

server:check-types: cache hit, replaying logs f8660170892af7dc
@glassroom/ui:check-types: cache hit, replaying logs c6e7fca088fe23f3
server:check-types: $ tsc --noEmit
@glassroom/ui:check-types: $ tsc --noEmit
web:check-types: cache hit, replaying logs 19cb3093d782e490
web:check-types: $ tsc --noEmit

 Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
  Time:    28ms >>> FULL TURBO

```

## added-suite-strict-types

Command: `bunx tsc --noEmit -p evidence/issues/131/crypto-release.tsconfig.json`

Exit code: **0**

```text
```

## build

Command: `bun run build`

Exit code: **0**

```text
web:build: ✓ Generating static pages using 5 workers (4/4) in 595ms
web:build:   Finalizing page optimization ...
web:build:
web:build: Route (app)
web:build: ┌ ○ /
web:build: └ ○ /_not-found
web:build:
web:build:
web:build: ○  (Static)  prerendered as static content
web:build:

 Tasks:    2 successful, 2 total
Cached:    2 cached, 2 total
  Time:    49ms >>> FULL TURBO

```

## unit

Command: `bun test tests/unit`

Exit code: **0**

```text
tests/unit/crypto-release.test.ts:
(pass) cross-module crypto release invariants > confirmed two-role session [6.64ms]
(pass) cross-module crypto release invariants > both transcript confirmations gate session access in either arrival order [2.61ms]
(pass) cross-module crypto release invariants > wrong secret never authenticates [1.24ms]
(pass) cross-module crypto release invariants > unauthenticated signaling and replay never advance handshake trust [4.09ms]
(pass) cross-module crypto release invariants > substitution never authenticates [6.57ms]
(pass) cross-module crypto release invariants > mixed-body nonce uniqueness [7.18ms]
(pass) cross-module crypto release invariants > fresh-room key separation [13.87ms]
(pass) cross-module crypto release invariants > session tamper, reflection, and replay release no body or verification control [5.90ms]
(pass) cross-module crypto release invariants > 4 KiB UTF-8 message limit after confirmed handshake [42.98ms]

 64 pass
 0 fail
 2557 expect() calls
Ran 64 tests across 5 files. [301.00ms]
```

## crypto-release

Command: `bun test tests/unit/signaling-crypto.test.ts tests/unit/handshake-crypto.test.ts tests/unit/data-envelope.test.ts tests/unit/crypto-release.test.ts`

Exit code: **0**

```text
tests/unit/crypto-release.test.ts:
(pass) cross-module crypto release invariants > confirmed two-role session [10.34ms]
(pass) cross-module crypto release invariants > both transcript confirmations gate session access in either arrival order [2.74ms]
(pass) cross-module crypto release invariants > wrong secret never authenticates [1.61ms]
(pass) cross-module crypto release invariants > unauthenticated signaling and replay never advance handshake trust [6.57ms]
(pass) cross-module crypto release invariants > substitution never authenticates [5.79ms]
(pass) cross-module crypto release invariants > mixed-body nonce uniqueness [7.27ms]
(pass) cross-module crypto release invariants > fresh-room key separation [12.93ms]
(pass) cross-module crypto release invariants > session tamper, reflection, and replay release no body or verification control [6.87ms]
(pass) cross-module crypto release invariants > 4 KiB UTF-8 message limit after confirmed handshake [35.72ms]

 53 pass
 0 fail
 2149 expect() calls
Ran 53 tests across 4 files. [271.00ms]
```

## chromium

Command: `PUBLIC_PORT=4131 NEXT_INTERNAL_PORT=5131 bunx playwright test --project=chromium tests/e2e/boot.spec.ts tests/e2e/data-envelope.spec.ts tests/e2e/preflight.spec.ts tests/e2e/signal-server.spec.ts --reporter=list`

Exit code: **0**

```text
  "scenario": "blocked-connectivity",
  "separatePersistentProfiles": [
    "/tmp/glassroom-preflight-a-fvn0mm",
    "/tmp/glassroom-preflight-b-U0p09n"
  ],
  "status": "failed",
  "testedOrigin": "https://localhost:4131",
  "timestamp": "2026-11-21T15:57:46.414Z"
}
  ✓  6 [chromium] › tests/e2e/preflight.spec.ts:458:1 › blocked-connectivity fails without relay or fallback (12.0s)
  ✓  7 [chromium] › tests/e2e/signal-server.spec.ts:9:2 › WSS admission, opaque forwarding, and participant-close teardown (1.1s)
  ✓  8 [chromium] › tests/e2e/signal-server.spec.ts:9:2 › WSS admission, opaque forwarding, and room-role-spoof teardown (1.1s)
  ✓  9 [chromium] › tests/e2e/signal-server.spec.ts:9:2 › WSS admission, opaque forwarding, and over-cap teardown (955ms)

  9 passed (25.9s)
```

## existing-root-types

Command: `bunx tsc --noEmit -p tsconfig.json`

Exit code: **2**

```text
tests/unit/data-envelope.test.ts(172,34): error TS18048: 'sender' is possibly 'undefined'.
tests/unit/data-envelope.test.ts(182,24): error TS18048: 'receiver' is possibly 'undefined'.
tests/unit/signaling-crypto.test.ts(98,33): error TS18048: 'sender' is possibly 'undefined'.
tests/unit/signaling-crypto.test.ts(103,23): error TS18048: 'receiver' is possibly 'undefined'.
tests/unit/signaling-crypto.test.ts(106,12): error TS18048: 'receiver' is possibly 'undefined'.
tests/unit/signaling-crypto.test.ts(106,41): error TS18048: 'sender' is possibly 'undefined'.
```
