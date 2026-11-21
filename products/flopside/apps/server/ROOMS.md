# In-memory rooms (#36)

## HTTP contract (#41)

`POST /api/rooms` and `POST /api/rooms/:code/join` accept exactly `{ "nickname": string }`. Nicknames are trimmed first, then validated with Zod as 1–16 UTF-16 code units (the JavaScript/Zod string-length convention). Empty/whitespace-only, 17-unit names, missing/non-string names, extra fields and malformed JSON are rejected. Codes are case-sensitive, six characters drawn from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` with cryptographic `randomInt`; generation retries an occupied code rather than overwriting its room.

Create returns **201**, join returns **200**, both with:

```ts
{
  seat: { id: string, index: number, nickname: string, connected: boolean, token: string },
  state: {
    code: string,
    hostSeatId: string,
    phase: "lobby" | "playing",
    revision: number,
    viewerSeatId: string,
    seats: Array<{ id: string, index: number, nickname: string, connected: boolean }>
  }
}
```

`seat.token` is a fresh 256-bit crypto credential, returned only in that seat's admission response. Keep it in tab-scoped `sessionStorage`, never URLs. `state` is explicitly allowlisted and contains **no tokens, match, deck, or cards**, including after start. Seat IDs (`seat-0` through `seat-3`) are room-local identifiers, not credentials. Duplicate nicknames are permitted; no accounts or spectators are added.

Errors contain only `{ error: { code } }`:

| Condition | Code | HTTP |
| --- | --- | --- |
| Invalid nickname/body | `ILLEGAL_ACTION` | 400 |
| Fifth lobby seat | `ROOM_FULL` | 409 |
| New seat after start | `MATCH_STARTED` | 409 |
| Unknown, malformed, or expired room code | `ROOM_EXPIRED` | 404 |
| Unknown seat on store operations | `AUTH_REQUIRED` | 403 when mapped by a transport |
| Non-host start or fewer than two connected seats | `ILLEGAL_ACTION` | 400 when mapped by a transport |

Unknown and expired codes deliberately share the PRD's `ROOM_EXPIRED`, with no automatic recreation. An unexpected internal route error returns sanitized `ILLEGAL_ACTION` at 500 without logging the exception/payload. `MATCH_STARTED` takes precedence over capacity once playing. HTTP start/resume/read endpoints are **not** added by #36.

## Store integration (#37 / #38 / #39)

`createApp({ roomStore?, allowedOrigins?, webRoot? })` creates a **new `RoomStore()` per app** unless a test/integration explicitly provides one. `/api/rooms` is mounted before static routes; `/`, production export serving and the temporary `/api/ws` probe retain their existing behavior. #38 must replace the temporary probe with authenticated gameplay sockets.

Import `RoomStore` and types directly from `apps/server/src/rooms.ts`. No shared room map is exported. The class encapsulates stored rooms/credentials using private fields. All operations are synchronous so #38 can put **every** HTTP/socket/timeout mutation through its per-room queue; #36 does not itself provide serialization beyond JavaScript's synchronous calls.

- `create(nickname): SeatAdmission` creates the host seat, revision 1, phase `lobby`.
- `join(code, nickname): SeatAdmission` adds the next stable index, incrementing revision. HTTP-created/joined seats start **disconnected**. Tests explicitly call connection methods when a connected fixture is required.
- `getLobby(code, seatId): LobbyState` gives a detached, viewer-specific metadata projection. A seat ID must exist, but **this is not authentication**: transports must validate the seat token before accepting a caller's seat ID.
- `markConnected(code, seatId)` / `markDisconnected(code, seatId)` update connectivity and increment revision only when the flag changes, returning a safe lobby view. In lobby, when the current host is disconnected, the lowest connected original seat index takes over. With nobody connected, the last host is retained until a connected seat is available. Reconnecting an old host does not take host ownership back. In play, disconnection does not change host or roster.
- `startMatch(code, seatId): LobbyState` requires the host and 2–4 connected seats, calls `@flopside/engine/dealing.startMatch`, stores its result privately and transitions to `playing` with one revision increment. The room roster stays locked and unchanged; **only connected seats enter the engine's match roster**, in room-index order. Disconnected lobby reservations remain in the room metadata but are not participants in that match. Downstream code must resolve engine participants by seat ID, not assume an engine index equals the original room index when some lobby seats were disconnected. A failed engine initialization leaves phase/revision/match unchanged.
- `getMatchState(code): MatchState | null` is **server-only** and returns a private detached clone. #37 must project/redact it before sending anything. Never serialize or log this return value. No reducer-update API, token-authentication/resume fencing, connection reservation timeout, or gameplay/rematch logic is added here; those belong to subsequent issues.
- `touch(code): void` refreshes idle activity for a live room. All room requests/commands above touch activity, including rejected requests/commands; malformed join bodies touch via the route before parsing. Activity does not change revision.

`RoomError.code` is a PRD error code; messages contain only the code, never names, tokens or private state.

## Idle clock and randomness

`new RoomStore({ now?: () => number, codeGenerator?: () => string, deckSource?: DeckSource })` supports isolated tests. Production `createApp()` constructs `new RoomStore()` **with no deck source or environment selector**; the engine's cryptographic production deck is the default. The constructor-only deterministic function is not reachable through HTTP, CLI or environment configuration. A unit test checks production construction and absence of environment selection in the store. Engine files are unchanged.

The server-owned clock defaults to `Date.now`. A room is live while `now() - lastActivityAt < 1_800_000`, and expires exactly at 30:00. Access checks expiry **before** touching, deletes expired state and returns `ROOM_EXPIRED`; it never recreates a match. Expiry is lazy (checked on each room operation), with a sweep on room creation to reclaim other expired entries; no timer is introduced ahead of #38's serialized timer work. Requests at 29:59.999 refresh activity, so boundary tests use separate fixtures for the exact-30:00 case. Expiry loses private state and seats by design; persistence is outside the PRD.

## Verification

From `products/flopside`, run `bun test apps/server/src/rooms.test.ts`. Tests use real Hono `app.request` calls for admission/errors and explicit synchronous store calls for the not-yet-exposed start/connection operations. They check every harness response for foreign credentials/private fields without printing credentials, and cover validation/schema bounds, codes/collisions, capacity, playing lock, host ownership/connected counts/transfers, revision behavior, isolated apps, detached state, fake-clock boundary/activity, and constructor-only deterministic decks. Full gate output is recorded under `evidence/i36/`.
