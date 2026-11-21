# Issues index

Generated from `docs/issue-specs/*.json` by `scripts/create_issues.py`. Each product has one epic; every child is a linked sub-issue with acceptance criteria and a verification outcome. Blocked-by relations are set between issues. Labels: `priority:*`, `type:*`, `product:*`, `area:*`. Each product has a milestone.

| Product | Epic | Issues | P0 | P1 |
|---|---|---|---|---|
| caret | [#1](https://github.com/jiaweing/manus-interview/issues/1) | 24 | 23 | 1 |
| flopside | [#26](https://github.com/jiaweing/manus-interview/issues/26) | 24 | 24 | 0 |
| patchbay | [#51](https://github.com/jiaweing/manus-interview/issues/51) | 23 | 23 | 0 |
| sidekick | [#75](https://github.com/jiaweing/manus-interview/issues/75) | 24 | 23 | 1 |
| tetherterm | [#100](https://github.com/jiaweing/manus-interview/issues/100) | 24 | 23 | 1 |
| glassroom | [#125](https://github.com/jiaweing/manus-interview/issues/125) | 24 | 23 | 1 |
| session-seven | [#150](https://github.com/jiaweing/manus-interview/issues/150) | 24 | 23 | 1 |

## Caret: desktop voice input (epic [#1](https://github.com/jiaweing/manus-interview/issues/1))

- [#2](https://github.com/jiaweing/manus-interview/issues/2) `P0` `setup` Scaffold an independent Bun project and boot the Electron desktop shell
- [#3](https://github.com/jiaweing/manus-interview/issues/3) `P0` `feature` Restrict renderer privileges and validate the preload message boundary
- [#4](https://github.com/jiaweing/manus-interview/issues/4) `P0` `feature` Implement single-instance tray startup and the fixed toggle shortcut
- [#5](https://github.com/jiaweing/manus-interview/issues/5) `P0` `feature` Render the six-state overlay without taking application focus
- [#6](https://github.com/jiaweing/manus-interview/issues/6) `P0` `feature` Add the bounded Win32 helper protocol and target snapshot operation
- [#7](https://github.com/jiaweing/manus-interview/issues/7) `P0` `feature` Request one Unicode paste only when the captured Windows target is unchanged
- [#8](https://github.com/jiaweing/manus-interview/issues/8) `P0` `feature` Restore owned clipboard text conditionally and reject unsupported formats
- [#9](https://github.com/jiaweing/manus-interview/issues/9) `P0` `verification` Pass the packaged Windows Notepad native-loop gate before cloud work
- [#10](https://github.com/jiaweing/manus-interview/issues/10) `P0` `feature` Implement the bounded session state machine and stale-response invalidation
- [#11](https://github.com/jiaweing/manus-interview/issues/11) `P0` `feature` Capture bounded WebM audio and release the microphone on every exit
- [#12](https://github.com/jiaweing/manus-interview/issues/12) `P0` `feature` Send one abortable OpenAI file-STT request with phrase hints
- [#13](https://github.com/jiaweing/manus-interview/issues/13) `P0` `feature` Apply one neutral cleanup request and reject invalid or renumbered output
- [#14](https://github.com/jiaweing/manus-interview/issues/14) `P0` `feature` Connect capture, transcription, cleanup, and one guarded paste attempt
- [#15](https://github.com/jiaweing/manus-interview/issues/15) `P0` `feature` Persist the protected provider key and disclose cloud processing in setup
- [#16](https://github.com/jiaweing/manus-interview/issues/16) `P0` `feature` Load local phrase configuration and pass it only as transcription hints
- [#17](https://github.com/jiaweing/manus-interview/issues/17) `P0` `feature` Remove transient content on termination and exclude sensitive data from logs
- [#18](https://github.com/jiaweing/manus-interview/issues/18) `P0` `test` Prove recording and cancellation release invariants with Linux fixtures
- [#19](https://github.com/jiaweing/manus-interview/issues/19) `P0` `test` Test neutral cleanup fidelity and embedded-instruction rejection
- [#20](https://github.com/jiaweing/manus-interview/issues/20) `P0` `test` Test IPC and insertion rejection paths with Linux protocol fixtures
- [#21](https://github.com/jiaweing/manus-interview/issues/21) `P0` `test` Run native Windows clipboard regression tests with preservation evidence
- [#22](https://github.com/jiaweing/manus-interview/issues/22) `P0` `verification` Verify Windows cancellation and target-switch safety without wrong-window pastes
- [#23](https://github.com/jiaweing/manus-interview/issues/23) `P0` `docs` Document the selected alternatives and Linux-to-Windows verification runbook
- [#24](https://github.com/jiaweing/manus-interview/issues/24) `P0` `verification` Package the portable Windows release and pass both application smoke checks
- [#25](https://github.com/jiaweing/manus-interview/issues/25) `P1` `verification` Rehearse the 4:30 PRD demo and capture requirement-linked pass evidence

## Flopside: multiplayer 2.5D browser poker (epic [#26](https://github.com/jiaweing/manus-interview/issues/26))

- [#27](https://github.com/jiaweing/manus-interview/issues/27) `P0` `setup` Scaffold and boot the independent Bun web and server apps
- [#28](https://github.com/jiaweing/manus-interview/issues/28) `P0` `verification` Prove published WebSocket ingress reaches one Bun instance
- [#29](https://github.com/jiaweing/manus-interview/issues/29) `P0` `feature` Evaluate the best five-card Hold’em hand and compare ties
- [#30](https://github.com/jiaweing/manus-interview/issues/30) `P0` `feature` Deal server-owned hands and advance Hold’em streets and actors
- [#31](https://github.com/jiaweing/manus-interview/issues/31) `P0` `feature` Enforce total-to wagers and full-raise reopening rules
- [#32](https://github.com/jiaweing/manus-interview/issues/32) `P0` `feature` Settle eligible side pots and return unmatched wagers
- [#33](https://github.com/jiaweing/manus-interview/issues/33) `P0` `feature` Expire turns against an authoritative 12-second deadline
- [#34](https://github.com/jiaweing/manus-interview/issues/34) `P0` `feature` Finish matches and reset eligible same-room rematches
- [#35](https://github.com/jiaweing/manus-interview/issues/35) `P0` `test` Prove the poker reducer’s edge cases with deterministic regressions
- [#36](https://github.com/jiaweing/manus-interview/issues/36) `P0` `feature` Create in-memory rooms and enforce lobby seating and start rules
- [#37](https://github.com/jiaweing/manus-interview/issues/37) `P0` `feature` Project viewer-specific snapshots and redact every card event
- [#38](https://github.com/jiaweing/manus-interview/issues/38) `P0` `feature` Serialize authenticated socket commands with revisions and deduplication
- [#39](https://github.com/jiaweing/manus-interview/issues/39) `P0` `feature` Resume reserved seats and settle matches after connection expiry
- [#40](https://github.com/jiaweing/manus-interview/issues/40) `P0` `feature` Bound transport input and prevent secret logging
- [#41](https://github.com/jiaweing/manus-interview/issues/41) `P0` `feature` Build the nickname lobby and shareable room invitation
- [#42](https://github.com/jiaweing/manus-interview/issues/42) `P0` `feature` Reconcile client snapshots and recover without replaying betting intent
- [#43](https://github.com/jiaweing/manus-interview/issues/43) `P0` `feature` Render legal poker controls and the free-chip rules summary
- [#44](https://github.com/jiaweing/manus-interview/issues/44) `P0` `feature` Render the responsive 2.5D table with accessible card labels
- [#45](https://github.com/jiaweing/manus-interview/issues/45) `P0` `feature` Display shared results and host-controlled same-room replay
- [#46](https://github.com/jiaweing/manus-interview/issues/46) `P0` `test` Assert private-card redaction across real HTTP and socket paths
- [#47](https://github.com/jiaweing/manus-interview/issues/47) `P0` `test` Test room capacity and queued recovery and completion boundaries
- [#48](https://github.com/jiaweing/manus-interview/issues/48) `P0` `test` Automate the two-context lifecycle with refresh and timeout
- [#49](https://github.com/jiaweing/manus-interview/issues/49) `P0` `verification` Verify the release on published WSS and save its checkpoint
- [#50](https://github.com/jiaweing/manus-interview/issues/50) `P0` `verification` Rehearse and capture the PRD’s timed two-browser demo

## Patchbay: local plugin-based AI agent harness (epic [#51](https://github.com/jiaweing/manus-interview/issues/51))

- [#52](https://github.com/jiaweing/manus-interview/issues/52) `P0` `setup` Scaffold the independent Bun project and boot an empty foreground CLI
- [#53](https://github.com/jiaweing/manus-interview/issues/53) `P0` `feature` Validate declarative manifests and local package boundaries
- [#54](https://github.com/jiaweing/manus-interview/issues/54) `P0` `feature` Preview and atomically install the reviewed package snapshot disabled
- [#55](https://github.com/jiaweing/manus-interview/issues/55) `P0` `feature` Apply schema-validated default and user configuration atomically
- [#56](https://github.com/jiaweing/manus-interview/issues/56) `P0` `feature` Persist explicit grants only for declared permissions
- [#57](https://github.com/jiaweing/manus-interview/issues/57) `P0` `feature` Show plugin declarations and redacted effective state in CLI inspection
- [#58](https://github.com/jiaweing/manus-interview/issues/58) `P0` `feature` Supervise shell-free workers with bounded JSON-RPC stdio transport
- [#59](https://github.com/jiaweing/manus-interview/issues/59) `P0` `feature` Activate plugins through authoritative handshakes and owned registrations
- [#60](https://github.com/jiaweing/manus-interview/issues/60) `P0` `feature` Dispatch exact capabilities with argument validation and host permission denial
- [#61](https://github.com/jiaweing/manus-interview/issues/61) `P0` `feature` Disable activations immediately while draining calls to their deadlines
- [#62](https://github.com/jiaweing/manus-interview/issues/62) `P0` `test` Prove lifecycle failures leave no routes and do not break healthy plugins
- [#63](https://github.com/jiaweing/manus-interview/issues/63) `P0` `test` Prove grant immutability and subprocess secret boundaries
- [#64](https://github.com/jiaweing/manus-interview/issues/64) `P0` `feature` Package read-only workspace search with file and result bounds
- [#65](https://github.com/jiaweing/manus-interview/issues/65) `P0` `feature` Package the llm@1 adapter for one existing local model endpoint
- [#66](https://github.com/jiaweing/manus-interview/issues/66) `P0` `verification` Preflight real local inference and tool-calling before building the agent loop
- [#67](https://github.com/jiaweing/manus-interview/issues/67) `P0` `feature` Compose a bounded CLI agent loop from enabled capabilities
- [#68](https://github.com/jiaweing/manus-interview/issues/68) `P0` `test` Test agent deadlines, truncation, denials, and disabled-adapter behavior
- [#69](https://github.com/jiaweing/manus-interview/issues/69) `P0` `verification` Verify real inference finds TODOs and observes Scout disable and re-enable
- [#70](https://github.com/jiaweing/manus-interview/issues/70) `P0` `test` Author an independent Text Metrics protocol conformance fixture
- [#71](https://github.com/jiaweing/manus-interview/issues/71) `P0` `verification` Record zero-host-change proof for live third-plugin installation
- [#72](https://github.com/jiaweing/manus-interview/issues/72) `P0` `docs` Document the manifest, extension protocol, and unsandboxed boundary
- [#73](https://github.com/jiaweing/manus-interview/issues/73) `P0` `test` Test package rejection and atomic state preservation through CLI commands
- [#74](https://github.com/jiaweing/manus-interview/issues/74) `P0` `verification` Rehearse the full release-gate demo within four minutes thirty seconds

## Sidekick: supervised Chrome side-panel agent (epic [#75](https://github.com/jiaweing/manus-interview/issues/75))

- [#76](https://github.com/jiaweing/manus-interview/issues/76) `P0` `setup` Scaffold the independent Bun workspace and boot only extension and proxy
- [#77](https://github.com/jiaweing/manus-interview/issues/77) `P0` `setup` Register the MV3 Side Panel and scoped browser permissions
- [#78](https://github.com/jiaweing/manus-interview/issues/78) `P0` `setup` Secure and publish the Hono proxy over authenticated HTTPS
- [#79](https://github.com/jiaweing/manus-interview/issues/79) `P0` `feature` Implement the Gemini single-tool turn endpoint and validated protocol
- [#80](https://github.com/jiaweing/manus-interview/issues/80) `P0` `feature` Build the borderless panel shell with context, token, and disclosure
- [#81](https://github.com/jiaweing/manus-interview/issues/81) `P0` `feature` Capture indexed top-frame DOM snapshots with document identity
- [#82](https://github.com/jiaweing/manus-interview/issues/82) `P0` `feature` Redact and bound snapshots while supporting targeted text observation
- [#83](https://github.com/jiaweing/manus-interview/issues/83) `P0` `feature` Reject stale actions before isolated content-script dispatch
- [#84](https://github.com/jiaweing/manus-interview/issues/84) `P0` `feature` Implement validated observe, find-text, and clamped scroll tools
- [#85](https://github.com/jiaweing/manus-interview/issues/85) `P0` `feature` Execute ordinary click and fill tools with local value checks
- [#86](https://github.com/jiaweing/manus-interview/issues/86) `P0` `feature` Manage requested tabs and pause or stop on browser-target changes
- [#87](https://github.com/jiaweing/manus-interview/issues/87) `P0` `feature` Enforce extension-side action safety and untrusted-page boundaries
- [#88](https://github.com/jiaweing/manus-interview/issues/88) `P0` `feature` Connect plan-before-Run to a one-action Gemini execution loop
- [#89](https://github.com/jiaweing/manus-interview/issues/89) `P0` `feature` Bound run duration and prevent uncertain mutation retries
- [#90](https://github.com/jiaweing/manus-interview/issues/90) `P0` `feature` Render explicit intent, execution, and outcome states in the timeline
- [#91](https://github.com/jiaweing/manus-interview/issues/91) `P0` `feature` Cancel pending requests and queued actions on Stop or panel closure
- [#92](https://github.com/jiaweing/manus-interview/issues/92) `P0` `feature` Bind risky-action confirmation to exact outbound data and target identity
- [#93](https://github.com/jiaweing/manus-interview/issues/93) `P0` `feature` Determine completion from fresh local and destination evidence
- [#94](https://github.com/jiaweing/manus-interview/issues/94) `P0` `test` Prove stale-index, malformed-tool, and injection defenses across boundaries
- [#95](https://github.com/jiaweing/manus-interview/issues/95) `P0` `test` Prove cancellation, denied submission, and network uncertainty end to end
- [#96](https://github.com/jiaweing/manus-interview/issues/96) `P0` `verification` Verify consecutive Wikipedia research actions and the reference tab
- [#97](https://github.com/jiaweing/manus-interview/issues/97) `P0` `verification` Verify dummy-form preparation, rejection, approved evidence, and Stop
- [#98](https://github.com/jiaweing/manus-interview/issues/98) `P1` `docs` Document unpacked installation and the required demo preflight
- [#99](https://github.com/jiaweing/manus-interview/issues/99) `P0` `verification` Rehearse the exact release demo twice within five minutes

## TetherTerm: MCP-controlled live terminal sessions (epic [#100](https://github.com/jiaweing/manus-interview/issues/100))

- [#101](https://github.com/jiaweing/manus-interview/issues/101) `P0` `setup` Scaffold the independent Bun server and prove genuine PTY support
- [#102](https://github.com/jiaweing/manus-interview/issues/102) `P0` `setup` Boot official MCP SDK entrypoints on stdio and Streamable HTTP
- [#103](https://github.com/jiaweing/manus-interview/issues/103) `P0` `feature` Enforce spawn configuration, cwd policy, and sanitized child environment
- [#104](https://github.com/jiaweing/manus-interview/issues/104) `P0` `feature` Create UUID sessions and expose nonblocking status and list
- [#105](https://github.com/jiaweing/manus-interview/issues/105) `P0` `feature` Record process exit and expire retained session records
- [#106](https://github.com/jiaweing/manus-interview/issues/106) `P0` `feature` Terminate sessions on kill or runtime expiry and clean ordinary children
- [#107](https://github.com/jiaweing/manus-interview/issues/107) `P0` `feature` Implement a Unicode-safe one-MiB output ring with byte cursors
- [#108](https://github.com/jiaweing/manus-interview/issues/108) `P0` `feature` Serialize terminal text writes and encode the supported keys
- [#109](https://github.com/jiaweing/manus-interview/issues/109) `P0` `feature` Resize live PTYs within the required dimension limits
- [#110](https://github.com/jiaweing/manus-interview/issues/110) `P0` `feature` Implement output, idle, and single-literal-pattern wait modes
- [#111](https://github.com/jiaweing/manus-interview/issues/111) `P0` `feature` Bound waits and remove canceled or completed wait listeners
- [#112](https://github.com/jiaweing/manus-interview/issues/112) `P0` `feature` Wire exactly eight schema-defined MCP tools to terminal services
- [#113](https://github.com/jiaweing/manus-interview/issues/113) `P0` `feature` Guard every HTTP request with bearer, Host, and Origin checks
- [#114](https://github.com/jiaweing/manus-interview/issues/114) `P0` `test` Prove session limits, exit retention, and ordinary-child cleanup
- [#115](https://github.com/jiaweing/manus-interview/issues/115) `P0` `test` Prove overflow gaps, Unicode boundaries, and bounded incremental reads
- [#116](https://github.com/jiaweing/manus-interview/issues/116) `P0` `test` Prove policy denials and credential exclusion before PTY spawn
- [#117](https://github.com/jiaweing/manus-interview/issues/117) `P0` `test` Prove HTTP authentication and request-origin rejection end to end
- [#118](https://github.com/jiaweing/manus-interview/issues/118) `P0` `test` Automate a persistent Python REPL through a real MCP client
- [#119](https://github.com/jiaweing/manus-interview/issues/119) `P0` `test` Automate confirmation and password prompts with resize and control keys
- [#120](https://github.com/jiaweing/manus-interview/issues/120) `P0` `test` Prove both transports and reconnect to existing terminal IDs
- [#121](https://github.com/jiaweing/manus-interview/issues/121) `P0` `verification` Verify an authenticated HTTPS tunnel with an independent MCP client
- [#122](https://github.com/jiaweing/manus-interview/issues/122) `P1` `docs` Document Bun startup commands and the server-host operating boundary
- [#123](https://github.com/jiaweing/manus-interview/issues/123) `P0` `docs` Document Manus connection steps and record the actual connection result
- [#124](https://github.com/jiaweing/manus-interview/issues/124) `P0` `verification` Rehearse the timed PRD demo and enforce the release pass criteria

## Glassroom: memory-only P2P encrypted chat (epic [#125](https://github.com/jiaweing/manus-interview/issues/125))

- [#126](https://github.com/jiaweing/manus-interview/issues/126) `P0` `setup` Scaffold the independent Bun project and boot one HTTPS/WSS origin
- [#127](https://github.com/jiaweing/manus-interview/issues/127) `P0` `verification` Gate the demo network with a two-profile direct-WebRTC preflight
- [#128](https://github.com/jiaweing/manus-interview/issues/128) `P0` `feature` Implement invitation-derived authenticated signaling encryption
- [#129](https://github.com/jiaweing/manus-interview/issues/129) `P0` `feature` Derive fresh ECDH session keys and a confirmed shared fingerprint
- [#130](https://github.com/jiaweing/manus-interview/issues/130) `P0` `feature` Implement authenticated data envelopes with directional sequence rejection
- [#131](https://github.com/jiaweing/manus-interview/issues/131) `P0` `test` Prove the cross-module crypto release invariants with regression tests
- [#132](https://github.com/jiaweing/manus-interview/issues/132) `P0` `feature` Enforce two-person admission and ciphertext-only server forwarding
- [#133](https://github.com/jiaweing/manus-interview/issues/133) `P0` `feature` Create and consume fragment invitations entirely in the client
- [#134](https://github.com/jiaweing/manus-interview/issues/134) `P0` `feature` Exchange the authenticated handshake over encrypted WSS signaling
- [#135](https://github.com/jiaweing/manus-interview/issues/135) `P0` `feature` Establish the ordered reliable WebRTC channel without fallback
- [#136](https://github.com/jiaweing/manus-interview/issues/136) `P0` `feature` Lock sending until both participants confirm the shared fingerprint
- [#137](https://github.com/jiaweing/manus-interview/issues/137) `P0` `feature` Send size-limited encrypted text and mark delivery only on peer acknowledgement
- [#138](https://github.com/jiaweing/manus-interview/issues/138) `P0` `feature` Render authenticated incoming text and return encrypted acknowledgements
- [#139](https://github.com/jiaweing/manus-interview/issues/139) `P0` `feature` Terminate sessions and discard all local state on leave or transport loss
- [#140](https://github.com/jiaweing/manus-interview/issues/140) `P0` `feature` Apply the borderless monochrome UI and keyboard-accessible security states
- [#141](https://github.com/jiaweing/manus-interview/issues/141) `P0` `feature` Expose bounded actual current-room ingress in a development-only inspector
- [#142](https://github.com/jiaweing/manus-interview/issues/142) `P0` `feature` Enforce production CSP and no-store same-origin privacy headers
- [#143](https://github.com/jiaweing/manus-interview/issues/143) `P0` `feature` Disable scaffold payload logging and redact application failures
- [#144](https://github.com/jiaweing/manus-interview/issues/144) `P0` `docs` Publish the threat-model table and verifiable security boundaries
- [#145](https://github.com/jiaweing/manus-interview/issues/145) `P0` `test` Test admission abuse and server termination against real Bun sockets
- [#146](https://github.com/jiaweing/manus-interview/issues/146) `P0` `test` Automate the two-profile verified messaging release flow
- [#147](https://github.com/jiaweing/manus-interview/issues/147) `P0` `test` Automate storage, teardown, and production privacy release checks
- [#148](https://github.com/jiaweing/manus-interview/issues/148) `P0` `test` Prove that acknowledged chat adds no actual server ingress frame
- [#149](https://github.com/jiaweing/manus-interview/issues/149) `P1` `verification` Rehearse the 4-minute-30-second judge walkthrough with release evidence

## Session Seven: code-authored cartoon showcase (epic [#150](https://github.com/jiaweing/manus-interview/issues/150))

- [#151](https://github.com/jiaweing/manus-interview/issues/151) `P0` `setup` Scaffold the independent Bun project and boot a pinned Remotion workspace
- [#152](https://github.com/jiaweing/manus-interview/issues/152) `P0` `setup` Verify Claude Opus 5.5 access and record reviewed authoring patches
- [#153](https://github.com/jiaweing/manus-interview/issues/153) `P0` `feature` Lock beat-grid scene records, sanitized fixtures and truthful caption validation
- [#154](https://github.com/jiaweing/manus-interview/issues/154) `P0` `verification` Benchmark a representative Remotion scene before building the full film
- [#155](https://github.com/jiaweing/manus-interview/issues/155) `P0` `feature` Implement Pip, 2.5D layers and borderless monochrome caption primitives
- [#156](https://github.com/jiaweing/manus-interview/issues/156) `P0` `feature` Animate the six-tile intro and credited independent-tile outro
- [#157](https://github.com/jiaweing/manus-interview/issues/157) `P0` `feature` Illustrate Caret desktop dictation without sending the inserted text
- [#158](https://github.com/jiaweing/manus-interview/issues/158) `P0` `feature` Illustrate Flopside play-money poker with private cards and shared showdown
- [#159](https://github.com/jiaweing/manus-interview/issues/159) `P0` `feature` Illustrate Patchbay CLI discovery with an unexecuted write-approval pause
- [#160](https://github.com/jiaweing/manus-interview/issues/160) `P0` `feature` Illustrate Sidekick supervised browser actions with an approval pause
- [#161](https://github.com/jiaweing/manus-interview/issues/161) `P0` `feature` Illustrate TetherTerm input and output in one persistent terminal session
- [#162](https://github.com/jiaweing/manus-interview/issues/162) `P0` `feature` Illustrate Glassroom paired encrypted text without anonymity claims
- [#163](https://github.com/jiaweing/manus-interview/issues/163) `P0` `feature` Bound the opt-in OpenRouter music smoke test behind validated access and rights
- [#164](https://github.com/jiaweing/manus-interview/issues/164) `P0` `feature` Synthesize the seeded 120 BPM fallback soundtrack entirely in JavaScript
- [#165](https://github.com/jiaweing/manus-interview/issues/165) `P0` `feature` Freeze validated audio caches and select fallback without render-time requests
- [#166](https://github.com/jiaweing/manus-interview/issues/166) `P0` `feature` Mix sparse action blips and master the frozen soundtrack to the required levels
- [#167](https://github.com/jiaweing/manus-interview/issues/167) `P0` `feature` Render the sole hero MP4 from validated scenes and frozen audio
- [#168](https://github.com/jiaweing/manus-interview/issues/168) `P0` `test` Automate timeline, caption and persistent-label requirement tests
- [#169](https://github.com/jiaweing/manus-interview/issues/169) `P0` `test` Prove offline audio selection, bounded provider behavior and secret exclusion
- [#170](https://github.com/jiaweing/manus-interview/issues/170) `P0` `test` Compare decoded pixels across repeated and shuffled-frame renders
- [#171](https://github.com/jiaweing/manus-interview/issues/171) `P0` `verification` Audit all reading holds, action results and cuts for visual truth and readability
- [#172](https://github.com/jiaweing/manus-interview/issues/172) `P0` `verification` Verify the final MP4 encoding, audio levels and complete watch-through
- [#173](https://github.com/jiaweing/manus-interview/issues/173) `P0` `docs` Document the rendering decision and hand off source, frozen audio and compact QA
- [#174](https://github.com/jiaweing/manus-interview/issues/174) `P1` `verification` Rehearse the under-five-minute judge demo against explicit pass evidence
