# Glassroom — P2P Encrypted Chat PRD

## 1. Overview

**Glassroom** is a memory-only, two-person browser chat with authenticated ephemeral key exchange, human fingerprint verification, and end-to-end encrypted text over WebRTC. A minimal inspector shows actual signaling-server ingress. Target: a six-hour demo, not an audited secure messenger.

## 2. Problem statement and the original brief

Address endpoint and infrastructure leakage, not merely browser-to-server encryption. Original-brief checklist:

- [ ] **R1:** Build a peer-to-peer encrypted chat room.
- [ ] **R2:** Users connect and send/receive messages.
- [ ] **R3:** Reduce leakage at sender, transit, intermediaries, and receiver.
- [ ] **R4:** Accounts/login are optional and not the focus; omit them.
- [ ] **R5:** Servers may provide discovery, signaling, or relay.
- [ ] **R6:** Do not equate HTTPS/WSS with end-to-end encryption.
- [ ] **R7:** Avoid absolute-security claims; explain verifiable boundaries.
- [ ] **R8:** Consider WebRTC data channels with a dumb signaling server.
- [ ] **R9:** Consider key exchange, fingerprint/SAS verification, and forward secrecy.
- [ ] **R10:** Consider WebCrypto.
- [ ] **R11:** Consider room secrets in URL fragments.
- [ ] **R12:** Explain why TURN receives ciphertext, not chat plaintext.
- [ ] **R13:** Address metadata leakage.
- [ ] **R14:** Avoid server-side persistence.
- [ ] **R15:** Define local-storage and ephemeral-message policy.
- [ ] **R16:** Address XSS, CSP, and SRI.
- [ ] **R17:** Explain endpoint-compromise limits.
- [ ] **R18:** Provide a verifiable threat-model table.
- [ ] **R19:** Demonstrate ciphertext-only chat visibility at the server using an inspector.

R5 permits signaling without message relay. R12 requires explanation, not integration. For R19, show encrypted signaling and verify chat bypasses the server; never fabricate server-side chat ciphertext.

## 3. Goals and non-goals

Deliver verified two-person messaging, no persistence, honest security boundaries, and reproducible evidence on the preflight-tested network.

**Explicitly out of scope:** WSS message fallback, TURN integration, ratcheting, groups, files, accounts, payments, extra platforms/providers, analytics, dashboards, bots, leaderboards, history/export, timed expiry, notifications, padding, animation, and polish.

Cut fallback: direct WebRTC satisfies the brief on a tested network. Restrictive networks remain unsupported; failure is explicit, never a plaintext downgrade.

## 4. Target users and key user stories

**US1:** Colleagues create/join and exchange text without login; reject a third participant. **US2:** Both compare fingerprints through a trusted call; sending stays locked until mutual confirmation. **US3:** A judge inspects server ingress, metadata, and absent chat traffic. **US4:** Leave/refresh removes local transcript and keys; neither enters application storage.

## 5. Core user flows

1. Create a random 128-bit room ID and 256-bit secret; deliberately copy `/r/{id}#s={secret}`. Link possession permits joining, not verified identity.
2. Join, remove the fragment with history replacement, and open WSS. Invalid/missing secrets fail locally. Fragments bypass HTTP requests but remain accessible to page code/extensions.
3. Exchange authenticated encrypted signaling; creator offers, joiner answers. Establish an ordered reliable WebRTC data channel. Unsupported crypto or negotiation failure disables chat; create a fresh room.
4. Compare grouped 128-bit fingerprints out-of-band. Both confirm through encrypted controls; mismatch terminates the room.
5. Send text; show delivery only after an encrypted peer acknowledgement. Render HTML as text.
6. Leave, refresh, or transport loss ends the session; discard local state and unsent text with a warning. No old-key reconnection, timers, or offline queue.

## 6. Functional requirements

All are **P0**; no stretch backlog.

- **F01:** Two-person admission, invitations, create/join/leave, connection/errors. **R1–R5, R11.**
- **F02:** WebRTC data channel; encrypted WSS signaling only; no relay fallback. **R5, R8, R12.**
- **F03:** WebCrypto ECDH, HKDF, authenticated encryption, transcript confirmation, fingerprint gate. **R6, R9, R10.**
- **F04:** Text up to 4 KiB UTF-8, encrypted acknowledgements, directional counters, tamper/duplicate rejection. **R2, R3.**
- **F05:** Memory-only transcript/drafts/keys/membership; disconnect teardown; no server message persistence. **R14, R15.**
- **F06:** Strict CSP, text rendering, redacted errors; no third-party resources or payload logs. **R3, R16.**
- **F07:** Threat table and current-room, development-only actual-ingress inspector; no test-control UI. **R7, R13, R17–R19.**

## 7. Non-functional requirements

**Reliability:** Preflight two desktop Chromium profiles. Abort negotiation after ten seconds. Never falsely acknowledge delivery or render unauthenticated content. Reject malformed/oversized frames and room-full attempts; stop sends under backpressure.

**Privacy:** HTTPS/WSS plus application E2EE. No database, localStorage, sessionStorage, IndexedDB, service worker, or crash reporting. Set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; disable body logging. Providers may retain access metadata outside application control.

**Accessibility:** Keyboard controls, visible focus, status announcements, and text security labels. No camera/microphone permission.

## 8. Proposed architecture and tech stack

Appendix B governs: Better-T-Stack, Next.js client, Hono/Bun WebSockets, browser WebCrypto/WebRTC, Zod, `bun test`, Playwright. One HTTPS origin; no database or external SDK.

`Browser A ↔ encrypted WSS signaling ↔ Hono ↔ Browser B`

`Browser A ↔ application-encrypted WebRTC data channel ↔ Browser B`

Server routes signaling, not messages. WebRTC transport encryption does not replace application authentication. TURN relays encrypted WebRTC packets, seeing network metadata rather than application keys/plaintext; this build does not configure/test TURN. Direct peers may learn each other’s IP addresses.

Bundle dependencies locally; pin the lockfile. SRI is inapplicable without CDN assets. No external scripts.

## 9. Data model / protocol / API surface

Server memory maps room IDs to two sockets maximum; delete on termination. `WS /signal` accepts validated join/encrypted-forward envelopes only. Visible fields: version, room ID, role, operation, ciphertext length. No message route.

HKDF-SHA-256 derives directional signaling keys from the invitation secret, salted by room ID. AES-GCM uses directional counter nonces and authenticates version/room/role. Never reuse key/nonce pairs; reject old counters.

Generate fresh ephemeral P-256 ECDH keys and participant nonces. Canonical creator-first transcript binds room, roles, public keys, and nonces. Derive directional AES-256-GCM session/confirmation keys from ECDH and transcript hash; mutually authenticate the transcript with HMAC. Derive fingerprints from session secret material; compare out-of-band before sending. Invitation authentication is insufficient if the link leaks.

Data envelopes contain session ID, sequence, ciphertext; encrypted bodies contain message, acknowledgement, verification, or end control. Use distinct directional keys, `zero32 || uint64(sequence)` IVs, authenticated session/direction/sequence, serialized sends, and old-counter rejection. No ratchet or resumption.

Inspector reads bounded, memory-only actual ingress for this room. Label signaling ciphertext/metadata; sending chat adds no server message frame. Disable in production; clear on teardown.

## 10. Risks, open questions, and mitigations

| Boundary | Mitigation | Verification and honest limit |
|---|---|---|
| Sender | Memory-only; strip fragment; deliberate copy | Storage/request check; OS, extensions, clipboard sync can expose secrets |
| Transit | Authenticated signaling, ECDH, AES-GCM, fingerprint | Tamper/wrong-secret tests; traffic blocking remains; leaked links require fingerprint checking |
| Intermediary services | No message routing, keys, persistence | Actual ingress; room IDs, socket IPs, timing, sizes remain; hosting sees access metadata |
| Receiver | Text rendering; memory-only; teardown | Refresh/storage check; copies, screenshots, endpoint compromise remain |
| Application delivery | Strict CSP; bundled dependencies | Headers and HTML-as-text test; malicious delivered code defeats E2EE |

Production CSP denies by default, restricts scripts/styles to local assets with framework-required script nonces, restricts connections to the exact origin, and forbids objects, framing, base URLs. No script `unsafe-inline`/`unsafe-eval`; development exceptions never ship.

Discarded ECDH keys aim for session-level forward secrecy, not per-message protection or compromise recovery. JavaScript cannot guarantee memory erasure. Main risks: handshake defects and blocked WebRTC; gate on tests/preflight. Open question: can the judge use two desktop Chromium profiles with direct-WebRTC connectivity?

## 11. Success metrics and a demo script

Release tests: two-profile create/join, third-person rejection, verification lock, bidirectional delivery, wrong-secret, tamper/counter rejection, fresh-session keys, HTML-as-text, storage/teardown, production headers. Marker must be absent from actual server ingress; sending adds no message frame. Evidence covers this build only.

**Judge walkthrough — 4 minutes 30 seconds:**

1. **0:00–0:45:** Create/join; fragment-free request, no login, third-person rejection. **R1, R2, R4, R5, R11.**
2. **0:45–1:40:** Compare/confirm fingerprints, send bidirectionally; explain WebCrypto and E2EE versus transport encryption. **R6, R8–R10.**
3. **1:40–2:35:** Inspect encrypted signaling/metadata; send marker, show no server chat frame. Explain untested TURN boundary. **R3, R12, R13, R19.**
4. **2:35–3:35:** Show HTML-as-text, CSP, empty storage, leave/refresh clearing state. **R14–R16.**
5. **3:35–4:30:** Read threat boundaries, show passing tests; “not audited; endpoint compromise remains.” **R7, R17, R18.**

## 12. Milestones and build plan

1. **0–0.5h:** One scaffold, same-origin WSS hosting, direct-WebRTC preflight.
2. **0.5–2h:** Crypto module; authentication, nonce, tamper, fingerprint tests.
3. **2–3.5h:** Admission, signaling, WebRTC, mutual verification.
4. **3.5–4.5h:** Text/acknowledgements, errors, teardown, accessible UI.
5. **4.5–6h:** Inspector, CSP/privacy overrides, browser tests, rehearsal.

**MVP cut line:** F01–F07 and release tests pass. Stop there; security/truthful evidence are mandatory. Failed preflight blocks delivery; it does not authorize fallback.

## 13. Promo-video hooks

- Matching fingerprints unlock a two-browser conversation.
- Plaintext endpoints beside real signaling ciphertext; “chat bypasses server.”
- Leave/refresh clears transcript: “memory-only, not screenshot-proof.”

## Appendix A: UI Design System (user directive)

Clean, minimal black-and-white shadcn/ui style, **NO borders**. Black `#000000`, white `#FFFFFF`, neutral greys only; status uses labels/fill inversion, not hue. No borders, outlines, dividers on controls/cards/panels/tables; use whitespace and subtle grey surfaces. Focus: 2px offset shadow-ring `#18181B`.

Necessary shadcn/ui, Tailwind, Radix primitives: border-width 0, 10px radius. Geist/Inter, 14px, weights 400/600. Body contrast ≥7:1; controls need distinct fill and visible hover/focus. No animation or separate dark-mode build.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/06-glassroom.sh` outside this repo. Create independent `glassroom/` project/git repo using the same Better-T-Stack scaffold: **one scaffold per project**, never a mega scaffold. This appendix wins stack conflicts. Bun throughout: `bun install`, `bun run`, `bunx`, `bun test`; Playwright browser tests.

Next.js client owns WebCrypto/WebRTC; no secrets in server components. Add strict CSP/security headers. Hono/Bun WebSockets: ciphertext-only signaling. **evlog privacy override:** log no bodies, URLs, payloads; inspector observes this actual server. Better Auth, MongoDB, Polar, wxt, native-uniwind remain dormant; no accounts/payments/extra platforms.
