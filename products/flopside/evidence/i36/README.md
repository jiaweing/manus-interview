# Issue #36 builder evidence

Implementation and downstream API contract: `apps/server/ROOMS.md`. All maintained changes are confined to `products/flopside`; `packages/engine` is untouched. The server declares its existing engine workspace dependency, with a one-line matching lockfile update.

The branch was rebased onto fetched `origin/main` before the final install/format/verification cycle. `fix-final.txt` records the final `bun run fix`; no diagnostic rules are suppressed. Earlier `*-initial.txt` / `*-second.txt` logs retain the actual initial lint/type errors and subsequent corrections rather than hiding them.

## Final gates

`verification.txt` records each command, execution timestamp, output-file location and exact exit code; each corresponding `*-final.txt` contains full output. Commands run from `products/flopside` after the last code/document edit:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test apps/server/src/rooms.test.ts
TEST_SERVER_PORT=3361 bun run test
bun run build
WEB_PORT=3360 bunx playwright test apps/web/tests/ingress.spec.ts --project=chromium
```

`TEST_SERVER_PORT=3361` gives the existing native Bun ingress unit test its own builder-owned listener. Playwright owns/cleans its production server on 3360; it still tests the actual built single-origin Hono/static Next/native WebSocket path. Copied screenshots and sanitized ingress marker evidence are saved here, not used to replace historical #28 evidence. No credentials or private match state are logged or captured.

The focused suite contains 38 tests, with real Hono `app.request` requests asserting `ROOM_FULL`, `MATCH_STARTED`, `ROOM_EXPIRED`, strict nickname/schema errors and caller-only tokens. Store-only tests explicitly opt into connected seats to verify not-yet-exposed start/connection commands. Full-suite counts and actual final verdicts are in the final logs, not inferred from this index.

## Unverified / deferred

- Docker build: not run, no docker in sandbox.
- Published HTTPS/WSS and reverse-proxy behavior: not run; this issue checks local production ingress only.
- Authenticated gameplay sockets, token resume/fencing, 60-second reservations, queued commands, privacy projections/events, lobby UI and end/rematch flows are subsequent issues (#37–#45), not implemented or claimed verified here.
- AI calls: not run, no key; AI is dormant and unnecessary.
- No independent-verifier verdict is claimed.

Idle expiry is lazy on access with a creation-time sweep, using injected `now()`; live activity refreshes before the next boundary. Room seats stay locked after start, while only connected seats are engine participants. These integration details are documented in `apps/server/ROOMS.md` for downstream builders.
