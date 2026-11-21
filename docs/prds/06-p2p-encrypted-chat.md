# Glassroom — P2P Encrypted Chat PRD

## 1. Overview

**Glassroom** is a disposable, two-person browser chat room for people who want a private conversation without creating accounts. Create an invitation, verify a shared fingerprint through a separate trusted channel, then exchange end-to-end encrypted text over WebRTC. If direct connectivity fails, an untrusted server forwards the same ciphertext. A live inspector makes the boundary visible: endpoints display messages; intermediaries receive encrypted payloads and routing metadata. Jia Wei Ng builds this from scratch in Manus Studio with AI assistance in one session, targeting an eight-hour MVP—not an audited replacement for a mature secure messenger.

## 2. Problem statement and the original brief

Ordinary chat sends readable content through infrastructure and often retains it indefinitely. Even a browser-to-browser connection can expose invitations, network addresses, plaintext at endpoints, or keys through hostile application code. Build a working room that reduces each leakage path and demonstrates what remains exposed.

Explicit requirements and requested considerations:

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

## 3. Goals and non-goals

The MVP must deliver understandable, verified two-party encryption, reliable small-text messaging, disposable state, and inspectable evidence. Prefer a narrow implementation that fails closed over a complex protocol with unexplained guarantees.

Non-goals are group rooms, accounts, offline delivery, attachments, searchable history, push notifications, anonymity, protection from screenshots or malicious recipients, and production cryptographic assurance. Session-level ephemeral ECDH is included; per-message forward secrecy, Double Ratchet, and post-compromise recovery are not. The relay fallback is visibly labeled and never described as a direct P2P route.

## 4. Target users and key user stories

**US1 — Private conversation:** As a colleague, I create a room and invite one person. Acceptance: two clean browser profiles exchange text without login; a third participant receives “Room full” without learning names or content.

**US2 — Verify the person:** As a cautious participant, I compare the room fingerprint over an existing trusted call. Acceptance: composition remains disabled until both participants confirm; mismatch ends the session, and the UI does not confuse link possession with verified identity.

**US3 — Inspect infrastructure:** As a judge, I examine what the server receives. Acceptance: real encrypted signaling and relayed-message frames are visible, a chosen plaintext marker is absent, and the panel separately identifies visible metadata.

**US4 — Leave no application history:** As either participant, I leave or refresh. Acceptance: that endpoint loses transcript and keys, reconnect requires a new room, and application storage contains no invitation, draft, transcript, or key.

## 5. Core user flows

1. **Create:** Generate a 128-bit random room ID and 256-bit invitation secret. Show a copyable link `/r/{id}#s={secret}` and a warning that anyone receiving it can attempt to join. No clipboard read occurs.
2. **Join:** Parse the fragment, immediately replace browser history with the fragment-free URL, then open WSS. The fragment is not included in the initial HTTP request, but browser extensions and page JavaScript can still access it [3]. Invalid or missing secrets fail locally.
3. **Connect:** Creator offers; joiner answers. Exchange encrypted handshake/SDP/ICE messages. Attempt WebRTC for ten seconds, then select encrypted WSS fallback. Unsupported WebCrypto blocks all chat; there is no plaintext fallback.
4. **Verify:** Display the same 32 hexadecimal fingerprint characters in eight groups and optional full hash on both endpoints. Compare out-of-band; both click “Matches.” An encrypted mutual confirmation unlocks messaging. Abort on mismatch or invalid key confirmation.
5. **Chat:** Render plain text, send authenticated ciphertext, and show “Delivered to peer application” only after an encrypted acknowledgement. No network previews, remote avatars, typing indicators, or desktop notifications.
6. **End:** Leave clears local state and sends encrypted end control. Messages expire locally after five minutes; rooms close after one hour. Refresh, socket loss, or a ten-second transport outage ends the session rather than resuming old keys. Disconnected unsent text is discarded with a warning.

Wrong invitations cannot decrypt signaling. Reject duplicate creators, third sockets, oversized messages, and malformed frames. A server can still deny service or occupy a room; the UI explains this instead of endlessly retrying.

## 6. Functional requirements

**P0 — MVP**

- **F01:** Implement creation/joining, two sockets maximum, fragment-secret handling, and explicit connection states. Covers R1–R5, R11.
- **F02:** Use ordered reliable WebRTC data channels and a WSS ciphertext-only fallback; select transport before enabling chat. Show Direct, TURN relay, or Server relay from actual connection state. Covers R5, R8, R12.
- **F03:** Implement ephemeral P-256 ECDH, HKDF-SHA-256, directional AES-256-GCM keys, authenticated signaling, mutual key confirmation, and fingerprint gating. Covers R6, R9, R10.
- **F04:** Support plain-text messages up to 4 KiB UTF-8, encrypted acknowledgements, unique sequence numbers, replay rejection, and tamper failure. Covers R2, R3.
- **F05:** Keep transcript/drafts/keys in memory only; implement expiration and teardown; never queue offline messages server-side. Covers R14, R15.
- **F06:** Apply production CSP, safe rendering, secret-redacted errors, and no third-party resources, analytics, or payload logs. Covers R3, R16.
- **F07:** Provide the threat-model panel, actual server ingress inspector, forced-relay demo mode, and tamper/replay test controls in development only. Covers R7, R13, R17–R19.

**P1 — Stretch:** F08 configures a paid/private TURN service with short-lived credentials and forced-relay testing; F09 adds a clearly labeled local “hide transcript” shortcut; F10 adds ciphertext padding to fixed buckets to reduce size leakage.

**P2 — Post-hackathon:** F11 adopts a reviewed authenticated protocol implementation and external security review; F12 explores per-message ratcheting. Neither is required for the demo, and neither is marketed before validation.

## 7. Non-functional requirements

**Latency/reliability:** Target direct connection within five seconds on the demo network, fallback within fifteen, and p95 delivery acknowledgement below one second for 100 messages. These are measured targets, not Internet-wide guarantees. No false delivered status; malformed ciphertext never renders.

**Privacy/security:** Use HTTPS/WSS for deployment and WebCrypto availability [2], plus application E2EE. No database, localStorage, sessionStorage, IndexedDB, service worker, crash reporting, or message-bearing URLs. Configure `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and disabled request-body logging. Hosting/network providers may retain access metadata outside application control.

**Performance:** Cap history at 200 messages, rooms at 100 concurrently, frames at 64 KiB, and ingress at 20 frames/second/socket. Pause sending above 256 KiB buffered output; cap pending sends at 20. Small messages and backpressure avoid data-channel blocking [1].

**Accessibility:** Keyboard-operable invitation, verification, composer, and leave controls; visible focus; screen-reader status updates; WCAG AA contrast. Encryption state uses text, not color alone. Never auto-copy secrets or require a camera/microphone.

## 8. Proposed architecture and tech stack

Use React + TypeScript + Vite, native browser WebCrypto/WebRTC, Node.js + `ws`, Zod validation, `bun test`, and Playwright. Run the frontend and small signaling service behind one HTTPS origin; no database or external SDK.

```text
Browser A: plaintext UI -> AES-GCM encryption
       |                         |
       | encrypted WSS signaling | ciphertext data channel
       v                         v
Node routing service       Browser B: decrypt -> plaintext UI
       |                    ^
       +-- ciphertext ------+  [WSS fallback]

Optional TURN: relays DTLS packets between browsers;
              never receives application decryption keys.
```

**Decisions:** Two-person rooms eliminate group-key management. P-256 uses established browser primitives without an added cryptographic dependency [2]. Encrypt signaling using invitation-derived keys so the application server cannot read SDP, ICE candidates, or ephemeral public keys. Then derive independent session encryption keys from ECDH; invitation secrecy alone is not the chat encryption key.

WebRTC already encrypts data channels with DTLS [1]; application encryption adds an inspectable boundary and allows the same protection over WSS. TURN relays WebRTC packets [4], exposing timing, size, and endpoint addresses but not chat plaintext. Direct peers can learn each other’s IP addresses; P1 relay-only TURN reduces that exposure, not exposure to the TURN operator.

**Rejected:** HTTPS-only chat lacks E2EE. A plaintext signaling exchange increases metadata exposure. A new Noise/Double-Ratchet implementation is too risky for one day. Manual SDP copy/paste makes the demo brittle. Server-side history undermines disposability. External scripts create unnecessary code-supply-chain exposure; bundle dependencies locally and pin the lockfile. SRI is not needed for absent CDN assets; add it if external static resources are ever introduced.

## 9. Data model / protocol / API surface

All binary fields use base64url. Reject unknown versions and additional fields. Server memory contains only `Map<roomId, {creatorSocket, joinerSocket, expiresAt}>`; it forwards immediately and deletes rooms on termination.

```ts
// WSS routing metadata is intentionally visible.
type Join = {v:1; op:"join"; room:string; role:"creator"|"joiner"};
type Relay = {v:1; op:"forward"; room:string;
  lane:"signal"|"data"; payload:string};
// Signal payload: AES-GCM encrypted Hello / SDP / ICE.
type Hello = {v:1; room:string; role:string;
  publicKey:string; nonce:string};
// Data-channel bytes or Relay.payload contain this envelope.
type Cipher = {v:1; session:string; seq:string; ciphertext:string};
// Encrypted body; acknowledgements reveal no plaintext to server.
type Body = {type:"message"|"ack"|"ready"|"end";
  id:string; text?:string; ackId?:string};
```

Invitation keys: HKDF from the random secret, salt=`roomId`, separate creator/joiner signal labels; AES-GCM uses random 96-bit IVs and AAD binding version, room, role, and lane. Include IV in the signal payload. Reject repeated IVs; limit sessions to 10,000 signal frames.

Handshake: generate fresh non-extractable ECDH private keys and 128-bit nonces. Canonical transcript fixes version, room, roles, both nonces, and raw public keys in creator-first order. HKDF consumes ECDH output with transcript hash as salt and separate directional encryption, confirmation-HMAC, and fingerprint labels. Exchange HMAC transcript confirmations before showing the fingerprint; derive its 128 bits from secret key material, not merely public-key hashes. Fingerprint comparison remains essential if the invitation leaks.

Chat IV=`zero32 || uint64be(seq)` with a distinct key per direction; AAD binds version, transcript-derived session ID, direction, and sequence. Serialize sends; never reuse counters/keys. Reject sequences at or below the received high-water mark. Termination creates no resumable session.

Module contracts: `createInvite()`, `joinRoom(invite)`, `deriveSession(peerHello)`, `confirmFingerprint()`, `encryptBody(body)`, `decryptEnvelope(frame)`, `leaveRoom()`. `GET /health` returns process status; `WS /signal` routes envelopes. Development-only `/debug/ingress` shows a bounded in-memory copy of actual received encrypted frames, not simulated data; production disables it.

## 10. Risks, open questions, and mitigations

| Threat / leakage boundary | Mitigation | Verification and remaining limit |
|---|---|---|
| Sender plaintext, invitation, clipboard | Memory-only state; strip fragment; no automatic clipboard access | Inspect storage/requests; extensions, OS, clipboard sync still win |
| Network interception or hostile signaling | Encrypted signaling, ECDH, authenticated encryption, fingerprint comparison | Tamper/replay tests; traffic can still be blocked |
| Server or TURN operator | No keys or persistence; ciphertext routing | Inspect real ingress; room IDs, IPs, timing, sizes remain visible |
| Malicious content or injected scripts | Text-only rendering; strict CSP; no remote resources | Render HTML attack as text; compromised code distribution defeats E2EE |
| Receiver retention or compromise | Expiration, teardown, explicit warning | Refresh/storage check; screenshots, memory snapshots, recipient copies remain possible |
| Later key compromise | Fresh ephemeral session keys; discard references | Reconnect changes fingerprint; current-session compromise exposes that session, with no per-message secrecy |

Production CSP uses `default-src 'none'`, self-hosted scripts/styles, exact WSS origin in `connect-src`, and `object-src`, `base-uri`, `frame-ancestors` set to `'none'`. Development HMR exceptions never ship. JavaScript cannot guarantee secure memory erasure; removing references is best effort.

Highest risks are bespoke handshake mistakes, malicious code delivery, and restrictive-network connectivity. Mitigate through deterministic crypto tests, pinned builds, clear warnings, and encrypted WSS fallback. Assume two-person desktop Chromium for MVP. Confirm later whether real users need group rooms or IP concealment; neither blocks this build.

## 11. Success metrics and a demo script

Ship only if all P0 tests pass, 100 bidirectional messages deliver without duplicates, wrong-secret/tamper/replay cases fail closed, and no plaintext marker appears in server ingress or application storage. Inspector evidence applies to the observed build and paths, not all future deployments.

**Judge walkthrough — 4 minutes 40 seconds:**

1. **0:00–0:40:** Create room, inspect fragment-free HTTP request, join from another profile; third profile is rejected. Verify no login. **R1, R2, R4, R5, R11.**
2. **0:40–1:20:** Compare fingerprints aloud, confirm both, send each direction; show actual Direct route from WebRTC stats. Explain WebCrypto/ECDH and session-only forward secrecy. **R6, R8–R10.**
3. **1:20–2:20:** Create a second room with “Force ciphertext relay” selected. Verify again, send `JUDGE-SECRET-8472`, and inspect actual server frames: marker absent, ciphertext changes for repeated text. Show encrypted signaling and visible room/timing metadata. **R3, R5, R13, R19.**
4. **2:20–3:10:** Flip one ciphertext byte and replay a frame; neither renders. Show HTML input rendered as text and deployed CSP. Explain TURN’s encrypted-packet boundary without pretending a WSS test proves TURN capture. **R6, R12, R16.**
5. **3:10–4:10:** Inspect empty application storage, leave, refresh, show missing transcript and deleted server room. **R14, R15.**
6. **4:10–4:40:** Open threat table and read endpoint/metadata limitations. Explicitly say “not audited; not absolutely secure.” **R7, R17, R18.**

## 12. Milestones and build plan

1. **Hour 0–1:** Scaffold Studio project, Node WSS route, same-origin deployment, and two-profile connectivity smoke test. Confirm WebSocket hosting before styling.
2. **Hour 1–2:** Implement crypto module and tests: matching derivation, fingerprint equality, wrong secret, altered AAD, tamper, replay, unique directional IVs, fresh-session keys.
3. **Hour 2–4:** Implement room admission, encrypted signaling, creator-led negotiation, WebRTC, pre-chat WSS fallback, and verification gate.
4. **Hour 4–5:** Add composer, encrypted acknowledgements, expiry, disconnect teardown, limits, and accessible states.
5. **Hour 5–6:** Add real ingress inspector and forced-relay/tamper controls; prove the marker never enters server plaintext.
6. **Hour 6–8:** Harden production headers/logging, run Playwright scenarios, fix connection failures, rehearse the timed demo.

**MVP cut line:** Steps 1–6 and F01–F07 complete. If behind, cut animations and decorative polish—not encryption, verification, fallback, or truthful evidence. P1/P2 begin only afterward. No security-review claim results from passing these tests.

## 13. Promo-video hooks

- Invitation opens in another browser; two identical fingerprints unlock the composer.
- Split-screen plaintext conversation beside real server ciphertext, with routing metadata labeled.
- A flipped ciphertext byte triggers rejection while the transcript stays unchanged.
- Leave/refresh makes the application transcript disappear; caption says “memory-only, not screenshot-proof.”
- Direct connection fails, then “Encrypted server relay” appears and messaging continues without a plaintext downgrade.

**References**

[1]: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels "MDN: Using WebRTC data channels"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey "MDN: SubtleCrypto deriveKey"
[3]: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment "MDN: URI fragment"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols "MDN: Introduction to WebRTC protocols"

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

Run `scaffold/06-glassroom.sh` from a workspace folder outside this repo. It creates `glassroom/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

Next.js: client with WebCrypto and WebRTC (secrets stay in the URL fragment; no secrets in server components; strict CSP and security headers must be added). Hono on Bun WebSockets: dumb signaling/relay that only sees ciphertext, replacing `ws`. **Privacy override:** the generated evlog setup must be configured to log no bodies, URLs, or payloads, and the 'server sees only ciphertext' inspector must run against this server. Better Auth, MongoDB, Polar, wxt and native-uniwind stay dormant (the PRD is account-free).
