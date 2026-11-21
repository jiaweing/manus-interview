# Switch Snatch — Multiplayer Browser Game PRD

Builder: Jia Wei Ng · Delivery: one Manus Studio session with AI assistance · Budget: 6–8 focused hours, up to one day

## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**Switch Snatch** is a two-player, 60-second browser heist. Rival thieves raid a shared vault, bank jewels, and flip its exits to sabotage each other. Touching a jewel-carrying opponent steals their loot. Target users are friends, colleagues, and hackathon judges seeking competitive fun without installation or accounts. One arena, two controls, visible consequences, and instant rematches make human competition tangible without complex physics.

## 2. Problem statement and the original brief (restate the requirement in your own words and list every explicit requirement from the brief as a checklist with IDs R1, R2...)

Build a complete, genuinely shared match rather than a multiplayer-looking frontend. Two independent browsers must join the same room, interact with the same authoritative world, and reach the same result. The brief leaves genre open; this PRD commits to a competitive tile-based heist.

- [ ] **R1:** Run a real-time multiplayer game directly in the browser.
- [ ] **R2:** Let at least two players enter the same match; MVP supports exactly two.
- [ ] **R3:** Show each other's actions through actual networking, not unrelated local screens.
- [ ] **R4:** Complete joining, starting, playing, and finishing or playing again.
- [ ] **R5:** Choose one specific, fun, original-feeling genre and mechanic.
- [ ] **R6:** Keep gameplay approachable but motivate finishing and human competition.
- [ ] **R7:** Address authoritative server ownership of gameplay.
- [ ] **R8:** Address WebSocket transport, room codes, and a lobby.
- [ ] **R9:** Address reconnection and interrupted sessions.
- [ ] **R10:** Address latency handling.
- [ ] **R11:** Address rematches.
- [ ] **R12:** Make the product deployable through Manus webdev.
- [ ] **R13:** Scope a from-scratch, AI-assisted single-builder session; label stretch goals separately.

## 3. Goals and non-goals

The MVP must make two strangers understand the objective within 15 seconds, share an authoritative result, and want another round. Optimize for a memorable reversal: steal a jewel, flip an exit, escape, bank the point. Ship the entire lifecycle before visual embellishment.

Non-goals are accounts, matchmaking, chat, spectators, bots, ranking, persistent statistics, custom maps, monetization, and four-player play. No client-authoritative scoring, peer-to-peer host advantage, complex physics, or production-scale infrastructure. Losing disposable matches during a backend outage is acceptable when clearly explained; silently diverging worlds is not.

## 4. Target users and key user stories (with acceptance criteria)

**US1 — Invite a friend.** As a host, I create a room and send a link. Acceptance: a six-character code and copyable URL appear; a second browser joins the same lobby within three seconds on a warm connection; a third receives “Room full.”

**US2 — Outsmart a human.** As a thief, I move, collect, steal, and flip exits. Acceptance: both browsers show the same gate phase, jewel owner, positions, and banked scores; an opponent's action visibly changes my available route.

**US3 — Finish fairly.** As a competitor, I know who won. Acceptance: the server ends play after 60 active seconds; both clients receive the same winner or draw and final scores; late inputs cannot change them.

**US4 — Recover and replay.** As a player, I refresh accidentally and return. Acceptance: my seat, score, and match survive within the reconnect window; both players requesting rematch resets gameplay without creating a new room.

## 5. Core user flows (step-by-step, include edge cases)

**Join and start:** 1. Enter a nickname of 1–16 characters. 2. Create a room or enter a case-insensitive code. 3. See two named seats, connection status, and a three-line tutorial. 4. Both players select Ready; the second confirmation triggers a server-timed three-second countdown. 5. Inputs unlock at the authoritative start time. Missing/full codes show actionable errors. A lobby disconnect clears readiness; the remaining player can replace the missing seat after its reservation expires.

**Play:** 1. Move with WASD/arrows or an on-screen directional pad. 2. Enter the center jewel tile to carry one jewel. 3. Return to your own base to bank one point; another jewel appears centrally after one second. 4. Press Space or Flip to alternate vault exits, with a personal two-second cooldown. 5. Enter the opponent's tile to take their carried jewel; the new carrier has one second of steal immunity. Players can share tiles; stealing occurs only when entering, not repeatedly while stationary. Banked points cannot be stolen.

The board is an open 7×7 grid with bases at `(0,3)` and `(6,3)`. A central 3×3 vault is enclosed by blocked boundary edges except four middle gates. Phase 0 opens east/west; phase 1 opens north/south. Gates block crossing edges, never occupying a tile, so a flip cannot crush or strand someone. Every attempted move, including a blocked one, consumes a 180ms movement cooldown. No diagonal movement.

**Interrupt, finish, rematch:** 1. A close event or six seconds without a presence ping pauses active time and blocks inputs. 2. Display “Opponent reconnecting — 15s.” 3. Reconnect with the saved seat credential; resume through a two-second countdown. 4. If the deadline expires, the sole connected player wins by forfeit; if neither remains, abandon the match. 5. At normal timeout, higher banked score wins; equal scores draw. Carried jewels do not count. 6. Two rematch votes reset positions, scores, cooldowns, jewel, and timer, then start a new countdown. One vote waits; leaving cancels the vote. Limit each match to two disconnect pauses per player; the next disconnect forfeits to prevent pause abuse.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

- **P0 / F01 — Rooms:** Create/join, invite URL, two seats, named lobby, ready/unready, and explicit invalid/full/expired errors. Covers R2, R4, R8.
- **P0 / F02 — Shared gameplay:** Implement the exact board and mechanics above, server-validated movement, scoring, steal immunity, gate cooldown, and countdown. Covers R1, R3, R5–R7.
- **P0 / F03 — Results:** Freeze state at timeout or forfeit; show result reason, both scores, and rematch votes. Covers R4, R6, R11.
- **P0 / F04 — Recovery:** Seat credentials, replacement connection fencing, pause/resume deadlines, and expired-seat handling. Covers R9.
- **P0 / F05 — Transport:** Native WebSocket snapshots with automatic HTTP fallback, acknowledgements, sequence deduplication, stale-input rejection, and network status. Covers R8, R10.
- **P0 / F06 — Delivery:** Manus-managed backend deployment, health endpoint, shared room store, published two-browser verification, and a completed MVP checkpoint. Covers R12, R13.
- **P1 / F07 — Polish:** Short sound cues after user interaction, mute, jewel trail, steal banner, gate-flip animation, and last-ten-seconds emphasis. Optional after all P0s.
- **P2 / F08 — Stretch only:** Spectators and a second arena. Neither may delay delivery or change the two-seat protocol.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

**Latency:** At RTT ≤150ms, target authoritative display p95 ≤250ms over WebSocket or ≤450ms with 250ms polling. Highlight local controls immediately; tween confirmed movement over 100ms. Never predict scoring or gates. Warn above 300ms RTT; suspend input after two seconds without snapshots.

**Reliability:** Idempotent commands, monotonic revisions, server timing, and refresh-safe seats are mandatory. Failed writes cannot produce success acknowledgements. Surface outages, never local substitute matches.

**Security/privacy:** Require HTTPS/WSS, schema validation, server-only secrets, random credentials, redacted logs, and Origin checks. Caps: 20 commands/second/seat, five room creations/minute/IP, 2KB inputs, 20 rooms. Render nicknames as text; expire rooms after 30 idle minutes. No tracking vendor.

**Performance/accessibility:** Target 60fps SVG rendering and ≤4KB snapshots. Bound outgoing queues; WebSocket lacks backpressure.[1] Provide labeled 44px controls, keyboard lobby navigation, focus indicators, player shapes plus colors, text status, and reduced motion. Full nonvisual gameplay is excluded.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

Use React, TypeScript, Vite, CSS, and SVG for the client; Node.js, Express, `ws`, Zod, and `ioredis` for the backend; `bun test` and Playwright for tests. One container serves built assets, HTTP APIs, and WebSocket upgrades on the same port. The `ws` library supports attachment to an HTTP server and heartbeat detection; browsers use their native WebSocket client.[2]

```text
Browser A / Browser B
  React + SVG + transport adapter
          | WSS /api/ws
          | HTTPS command + snapshot fallback
          v
Node container(s): Express + ws
  authenticate -> validate -> pure game reducer
          | GET state -> compare-and-set + publish
          v
Manus managed Redis
  ephemeral rooms, revisions, deadlines, pub/sub
```

Redis stores authoritative state; Node applies rules through an atomic revision-checked Lua commit that also publishes sanitized snapshots. Retry conflicts five times. Instances subscribe for their connected rooms; periodic snapshots recover missed publication. No undocumented single-instance or sticky-routing assumption.

Actions advance gameplay without physics ticks. A 250ms watchdog advances deadlines for attached rooms; reconnection advances overdue deadlines. Both use the conflict-safe reducer. Event-driven tiles make HTTP fallback playable.

Reject WebRTC's signaling and peer-authority complexity, unnecessary physics engines, and process-only state that splits across deployments. Skip a database: matches are disposable.

Deploy through Manus server/Redis capabilities, a pinned Docker build, `PORT`, and unauthenticated `/api/health`. Container-serve all routes. Verify published WS upgrades: consulted guidance does not guarantee ingress support. Require genuine networked HTTP fallback. Disclose Redis billing and deletion-on-depleted-balance before enabling it; preserve existing hosting policy.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

Core shared TypeScript shapes:

```ts
type Phase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'finished';
type Seat = 'A' | 'B';
type Player = {
  name: string; x: number; y: number; score: number;
  lastSeq: number; sessionId: string; lastSeenAt: number;
  moveReadyAt: number; flipReadyAt: number; pauseCount: number;
  ready: boolean; rematch: boolean;
};
type Room = {
  code: string; rev: number; matchId: string; phase: Phase;
  players: Partial<Record<Seat, Player>>; gatePhase: 0 | 1;
  carrier: Seat | null; jewelAvailableAt: number; stealImmuneUntil: number;
  startAt: number | null; endAt: number | null;
  remainingMs: number; reconnectUntil: number | null;
  winner: Seat | 'draw' | null; reason: string | null;
};
type Command = {
  v: 1; matchId: string; seq: number; sessionId: string;
  action: 'move' | 'flip' | 'ready' | 'rematch' | 'leave';
  direction?: 'up' | 'down' | 'left' | 'right'; value?: boolean;
};
```

`POST /api/rooms {name}` and `POST /api/rooms/:code/join {name}` return `{code, seat, token, sessionId, snapshot}`. `POST /api/rooms/:code/resume` authenticates the token, replaces `sessionId`, and returns a full snapshot. HTTP command requests use Bearer authentication. WebSocket sends `{type:'auth',token,sessionId}` as its first frame; reject unauthenticated traffic after three seconds. Store credentials in tab-scoped `sessionStorage`, never invite URLs.

`POST /api/rooms/:code/commands` returns `{seq,accepted,error?,snapshot}`. `GET /api/rooms/:code/snapshot` supports fallback polling; `POST .../presence` and equivalent WS frames run every two seconds while the user is connected. WS broadcasts `{type:'snapshot',v:1,rev,serverNow,state}` and command acknowledgements. State excludes session IDs and credential material. Reject wrong match IDs, old sessions, duplicate sequences, and gameplay outside `playing`. Serialize races by successful commit order; explain that lower latency remains an advantage without rollback.

Redis key `ss:room:<code>` stores internal JSON with a 30-minute sliding TTL; atomic creation prevents code collisions. `ss:events:<code>` carries public snapshots. Signed seat tokens include room, seat, random membership ID, and expiry; store membership IDs internally and rotate them on seat replacement. Protocol errors include `ROOM_FULL`, `ROOM_EXPIRED`, `SESSION_REPLACED`, `STALE_MATCH`, `COOLDOWN`, and `STORE_UNAVAILABLE`. Page manifest: `{"routes":[{"path":"/","title":"Switch Snatch"}]}`; invitations use `/?room=ABC234`.

## 10. Risks, open questions, and mitigations

**Deployment:** Prove WS ingress, Redis pub/sub, and latency in a 45-minute spike. WS/pub/sub failure triggers shared-state HTTP fallback; unavailable Redis is a blocker, not permission for local substitutes.

**Scope:** Keep one immutable map, no prediction, and one reducer for both transports. Cut P1/P2 first.

**Fun/fairness:** Cooldowns and bank-only scoring counter camping and spam. Run three playtests; tune constants, not mechanics. Repeated zero-score draws signal unclear onboarding.

**Outage:** Redis loss erases rooms. Show “Match unavailable — create a new room”; do not promise durability.

Questions for Jia Wei: Is managed Redis billing acceptable? Which demo devices? Default to Redis after disclosure, keyboard and touch. Genre is settled.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Release targets: ten completed two-client matches without divergent results; reconnect succeeds in all five deliberate refresh tests; eight of ten first-time pairs finish; at least half voluntarily choose rematch. Use local test notes and server counters, not an analytics installation. These are targets, not claimed results.

**0:00–0:35:** Open the published URL on two devices, create and join by code, show named seats; try a third tab and see “Room full.” Verifies R1, R2, R8, R12.

**0:35–0:50:** Both Ready; watch the synchronized countdown. Briefly explain steal, bank, and Flip. Verifies start flow and chosen concept, R4–R6.

**0:50–1:15:** Move one player while watching the other screen; take a jewel, flip a gate, show the blocked crossing, then steal and bank. Both scores agree. Verifies R3, R5–R7. Display transport, revision, and acknowledgement latency in a collapsible debug panel, R10.

**1:15–1:35:** Refresh one device; the other pauses; reconnect with the same seat and score. Verifies R9. Toggle a debug “HTTP transport” switch and show an opponent movement still arriving, R8/R10.

**1:35–2:20:** Play until the normal timer ends. Both screens show identical final scores and winner/draw; movement is disabled. Verifies R4, R6, R7.

**2:20–2:40:** One rematch vote waits; the second starts a reset countdown in the same room. Verifies R11. Show the finished MVP checkpoint and explicitly deferred stretch items, R13. Total demonstration stays below three minutes, leaving margin for questions.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **0:00–0:45 — Spike:** Initialize Manus project; disclose/enable server and Redis; publish health/API/WS; prove shared state and HTTP fallback.
2. **0:45–2:00 — Rules:** Implement board, reducer, CAS, tokens, schemas, and fake-clock tests covering steals, cooldowns, timeout, deduplication, and conflicts.
3. **2:00–3:15 — UI:** Wire invitations, lobby, readiness, countdown, SVG arena, keyboard/touch, HUD, and results directly to networking.
4. **3:15–4:30 — Recovery:** Implement presence, session fencing, pauses, resume, forfeit, rematch, fallback, and errors.
5. **4:30–6:00 — Ship:** Run two-context Playwright, simultaneous pickups, stale-input tests, published verification, mobile checks, three playtests, and checkpoint.

**MVP cut line:** All F01–F06 work on the published product; normal completion, refresh recovery, and rematch are demonstrated. If time runs out before this line, stop polish and fix lifecycle failures. **6:00–8:00:** Only then add F07 audiovisual polish. F08 remains a separate, clearly uncommitted stretch backlog.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- Split-screen: a code copied on one laptop becomes the second player's seat on a phone.
- Jewel chase: the thief nearly reaches home, gets tagged, and the jewel trail switches owners.
- The sabotage moment: a Space press rotates the vault exits simultaneously on both screens.
- Final-second bank: the score changes just before both devices reveal the same winner.
- Rematch revenge: two votes light up, the arena resets, and “Run it back” becomes a countdown.

**References**

[1]: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket "MDN WebSocket API and backpressure constraints"
[2]: https://github.com/websockets/ws "ws official HTTP attachment and heartbeat documentation"

## Appendix A: UI Design System (user directive)

Style: clean, minimal, black and white, shadcn/ui look and feel, with **no borders**.

- **Palette:** pure black `#000000`, white `#FFFFFF`, and a neutral grey ramp (`#FAFAFA`, `#F4F4F5`, `#E4E4E7`, `#71717A`, `#18181B`) for surfaces and text. No accent colour. State is conveyed by weight, fill inversion (black on white or white on black), icons and labels, never by hue alone.
- **No borders:** no `border`, `outline` or divider lines on cards, inputs, buttons, tables or panels. Separate elements with whitespace, a subtle surface tone (`#F4F4F5` on white) and, when elevation is needed, a very soft shadow. Focus rings are replaced by a 2px offset shadow-ring in `#18181B`, which keeps keyboard focus visible and accessible.
- **Components:** shadcn/ui primitives (Button, Input, Card, Dialog, Tabs, Sheet, Tooltip, Badge, Switch, Toast) with Tailwind and Radix, restyled with border-width 0. Radius 10px (`--radius: 0.625rem`).
- **Typography:** Geist or Inter, 14px base, tight tracking on headings, two weights (400 and 600).
- **Motion:** 150ms ease-out opacity and translate only. Respect `prefers-reduced-motion`.
- **Dark mode:** an inverted pair (`#000` background, `#FAFAFA` text) with the same no-border rule.
- **Accessibility:** contrast of at least 7:1 for body text. Because borders are absent, every interactive control needs a distinct filled surface or a visible hover and focus state. Verify this in the demo checklist.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/02-switch-snatch.sh` from a workspace folder outside this repo. It creates `switch-snatch/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

Next.js: lobby and game client. Hono on Bun native WebSockets (`hono/bun` `upgradeWebSocket`): authoritative game server, replacing the PRD's Express + `ws`. In-memory rooms on one instance replace the PRD's Redis for the MVP (the HTTPS polling fallback stays); MongoDB/Mongoose is optional for match history. Dormant: Polar, wxt, native-uniwind (a phone controller is a stretch). Better Auth is optional (guest play is the default).
