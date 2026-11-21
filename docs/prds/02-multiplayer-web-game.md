# Flopside — Multiplayer Browser Poker PRD

Builder: Jia Wei Ng · Delivery: one AI-assisted Manus Studio session · Budget: 6 focused hours; correctness before polish.

## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**Flopside** is simple browser-based 2.5D Texas Hold’em for friends and judges. Two to four people create/share/join a room, start, play hands, finish, and rematch. Heads-up must work. **Play-money only: no purchases, cash-out, or prizes.** Plain poker is the MVP; no twist is assumed.

## 2. Problem statement and the original brief (restate the requirement in your own words and list every explicit requirement from the brief as a checklist with IDs R1, R2...)

Deliver a networked match with a complete lifecycle. R1–R6 map to the original brief; R7–R13 support delivery.

- [ ] **R1:** Real-time multiplayer directly in the browser.
- [ ] **R2:** At least two players; 2–4 seats, including heads-up.
- [ ] **R3:** Other players’ actions appear through actual networking.
- [ ] **R4:** Complete joining, starting, playing, finishing, and playing again.
- [ ] **R5:** Specific mechanic: simple Texas Hold’em.
- [ ] **R6:** Approachable gameplay and human competition.
- [ ] **R7:** Authoritative server ownership and private hole cards.
- [ ] **R8:** WebSockets, room codes, and lobby.
- [ ] **R9:** Minimal seat-token reconnection.
- [ ] **R10:** Handle latency without divergent gameplay.
- [ ] **R11:** Same-room rematches.
- [ ] **R12:** Ship as a self-hosted production build (one Bun process, Dockerfile); no Manus webdev.
- [ ] **R13:** From-scratch, AI-assisted single-builder delivery within the MVP cut line.

## 3. Goals and non-goals

Ship correct poker, hidden cards, legal-action controls, shared results, and rematch. A short rules summary explains turns and free chips.

**Explicitly out of scope:** bots, chat/emotes, graphs, history/export, spectators, accounts, payments, leaderboards, analytics, Mongo/persistence, mobile companions/controllers, extra providers, polling fallback, verifiable shuffle, and effects beyond deal/flip/chip movement.

## 4. Target users and key user stories (with acceptance criteria)

**Invite:** Nickname-only creation; six-character code/link; 2–4 seats; fifth player receives `ROOM_FULL`.

**Play privately:** Same board, pot, stacks, and turn; only own hole cards before showdown.

**Finish/replay:** Identical winner, stacks, and termination reason; same-room rematch resets stacks.

**Recover:** Refresh within 60 seconds restores seat/private view without resetting the deadline.

## 5. Core user flows (step-by-step, include edge cases)

**Join/start:** Enter a 1–16-character nickname → create/share or join by code/link → lobby → host starts with 2–4 connected players. Lock roster; reject new seats during play. Transfer lobby host to lowest connected seat if needed.

**Play:** Each starts with 200 chips; fixed blinds 5/10; no-limit preflop, flop, turn, river. Rotate dealer. Heads-up dealer posts small blind, acts first preflop and last postflop. Otherwise action starts left of big blind preflop, left of dealer postflop. Skip folded/all-in seats. Offer fold/check/call/bet/raise/all-in. Wagers specify total street contribution. Minimum opening bet is 10; enforce full-raise increments and short-all-in reopening rules. Return unmatched excess, settle eligible side pots, and run out the board when betting cannot continue. Reveal non-folded contenders at contested showdown; folded cards stay hidden.

**Finish/recover:** Turns last 12 seconds, then auto-fold; disconnection never pauses them. Reserve disconnected seats for 60 seconds. Expiry ends the match after current-hand settlement; highest-stack connected player wins, ties share victory, none means abandoned. Otherwise end after a bust or 10 hands; highest stack wins, ties share victory. Host rematches with at least two connected seats, resetting stacks, cards, dealer, and counters. Idle rooms expire after 30 minutes.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

All retained requirements are P0; no P1/P2 backlog.

- **F01 — Rooms:** Create/share/join/start, 2–4 seats, lobby/errors. R2, R4, R8.
- **F02 — Poker:** Authoritative shuffle, betting, timer, evaluator, side pots/settlement. R1, R3, R5–R7.
- **F03 — Privacy:** Redact every snapshot/event; no foreign private cards or undealt deck. R3, R7.
- **F04 — Recovery:** Tokens, reconnect, revisions, duplicate protection, deadlines/connection status. R8–R10.
- **F05 — Completion:** Shared results and rematch. R4, R6, R11.
- **F06 — Delivery:** Production-build WebSocket ingress check, rules/privacy tests, two-browser e2e/checkpoint. R12, R13.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

**Reliability:** Disable repeat clicks until acknowledgement. Server revisions reconcile clients; never predict chips/cards. Show connection failures, not local substitute games. Background tabs cannot extend deadlines.

**Security:** HTTPS/WSS, allowed-Origin checks, schema validation, unpredictable seat tokens, bounded rates/payloads. Never log tokens, private cards, decks, or full payloads. Serialize room mutations, including timeouts.

**Usability:** Responsive table, rank/suit labels, keyboard controls, 44px targets, visible focus and reduced motion. Never announce hidden cards. No unverified performance claims.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

Better-T-Stack: Next.js/TypeScript, Tailwind/shadcn, CSS/SVG; Hono on Bun native WebSockets via `hono/bun` `upgradeWebSocket`. One backend instance stores rooms in memory with a pure rules reducer.

```text
Browser A                 Browser B
own redacted view         own redacted view
         \                 /
             WSS /api/ws
                   |
         Hono/Bun room queue
                   |
       private rules/state/deadlines
                   |
         per-connection redaction
```

Server owns shuffle, legality, evaluation and settlement. Use cryptographic randomness with unbiased Fisher–Yates; fairness is trusted, not verifiable. CSS perspective and layered cards/chips provide 2.5D; HUD stays upright. Only deal/flip/chip movement animate; reduced motion uses instant updates. Reject WebGL, distributed state and polling. Verify published WSS first; unsupported ingress is a blocker, not permission to replace the scaffold.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

`Room`: code, host/seats, phase/revision, match/hand IDs, dealer, private deck/cards, board, stacks/contributions, fold/all-in flags, raise rights, actor/deadline, connectivity/results.

`POST /api/rooms {nickname}`, `POST /api/rooms/:code/join {nickname}`, `POST /api/rooms/:code/resume {token}` return seat and viewer-specific state. Tokens stay in tab-scoped `sessionStorage`, never URLs. Resume fences the old socket.

Socket authentication: `{code,token}`. Commands: `{seq,expectedRev,handId,action,totalTo?}` for start, betting and rematch. Acknowledgement: `{seq,accepted,rev,error?}`. Duplicate sequences cannot reapply wagers. Reject stale state, wrong turns and invalid amounts; never automatically retry changed betting intent.

Snapshots: `{rev,serverNow,view}`. View contains public state, own cards and legal actions; opponents get backs until eligible showdown. Redact animation events identically. Reconnect gets fresh state; heartbeat detects loss. Errors: `ROOM_FULL`, `MATCH_STARTED`, `ROOM_EXPIRED`, `AUTH_REQUIRED`, `STALE_STATE`, `NOT_YOUR_TURN`, `ILLEGAL_ACTION`.

## 10. Risks, open questions, and mitigations

**Deployment:** Verify published WebSockets first. In-memory rooms require one instance; restart loses matches and must show “Room lost — create again.”

**Correctness:** Test heads-up order, short raises, side pots and redaction before effects. Timers/reconnect share the room queue.

**User question:** What poker “twist,” if any, is required? Plain Hold’em remains the default until clarified; do not invent one.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Pass: green tests, published two-browser lifecycle, identical settlements, recovery without timer reset, and zero private-state leakage. No analytics.

- **0:00–0:40:** Create/share/join/start in two browsers; explain rules/free chips. R1, R2, R4–R6, R8, R12.
- **0:40–1:20:** Bet/call; observe synchronization and inspect received frames for redaction. R3, R7, R10.
- **1:20–1:50:** Refresh; restore seat/cards without deadline reset. Let a turn expire to demonstrate auto-fold. R9.
- **1:50–3:30:** Finish a hand, then all-in/bust with matching results. A labeled test deployment may use the existing deterministic deck mechanism; disable it in normal deployment. Humans act; server validates. R4–R7.
- **3:30–4:30:** Rematch/reset; show rules/redaction/e2e tests and checkpoint. R11, R13.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **0:00–0:30:** Scaffold/boot; published two-browser WSS and single-instance check.
2. **0:30–2:30:** Reducer/evaluator; test ranks, wheel/kickers/ties, side pots/refunds, heads-up order, short raises, chip conservation and fake-clock auto-fold.
3. **2:30–4:00:** Rooms, recovery, deduplication/redaction. Test viewer snapshots/events, including reconnect and folded showdown cards.
4. **4:00–5:00:** Lobby, legal-action HUD, 2.5D table, results/rematch/errors.
5. **5:00–6:00:** One Playwright two-context e2e: join→start→play→finish→rematch, refresh/timeout. Verify four-seat capacity; run published demo/checkpoint.

**MVP cut line:** F01–F06/tests pass. If behind, omit animation; never cut authority, redaction, heads-up, side pots, timeout or lifecycle.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- Shared code fills a seat in the second browser.
- Private cards flip while opponents see backs and wagers.
- Both browsers show the same winner, then rematch.

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

Use `scaffold/02-flopside.sh` outside this repo to create independent `flopside/`, with the **same Better-T-Stack command** in `docs/stack.md`: **one scaffold per project; Bun everywhere** (`bun install`, `bun run`, `bunx`, `bun test`). **This appendix overrides Section 8.** Verify install/boot with TTY addon prompts. Next.js serves lobby/table; Hono/Bun owns WebSockets/in-memory poker. Leave generated auth, persistence, payments, extension/mobile integrations unwired. Playwright supplies e2e; renaming is implementation work.
