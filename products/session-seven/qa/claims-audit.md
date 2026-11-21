# Issue #153 — Claims audit

This audit compares the locked `apps/video/src/timeline.js` wording with the six product PRDs and Session Seven PRD §§9–11. No supporting implementation evidence was supplied for these six product records. PRDs describe intended behavior, not proof that it works; the Session Seven evidence ledger records scaffold verification only. Every product therefore remains `concept` with `evidenceRef: null`, an “Exploring…” claim, and the persistent **Concept** / **Illustrated UI** labels defined by the shared data. Intro/outro have no status key.

| Scene / product | Exact claim | Source PRD section | evidenceRef | Status | Wording decision |
|---|---|---|---|---|---|
| Intro | Six ideas. One build session. | `docs/prds/07-promo-video.md` §11, intro row; §9 framing status | none | omitted | Exact framing caption. Six separate ideas, not an integrated suite or six completed releases. |
| Caret | Exploring desktop dictation: spoken words become text at the caret, without submission. | `docs/prds/01-desktop-voice-input.md` §1; §6 F05–F06; §3 non-goals; Session Seven §11 Caret row | none | concept | Explicit desktop dictation, not universal voice control. Text insertion is illustrated; no Send, submitted-message state, confirmed native acceptance, or Windows implementation proof. |
| Flopside | Exploring multiplayer poker with free play-money chips, private cards and a shared showdown. | `docs/prds/02-multiplayer-web-game.md` §1; §5 Play; §6 F03/F05; Session Seven §11 Flopside row | none | concept | Free play-money chips only. Private backs and shared showdown are illustrated, not evidence of a running networked game. No currency, purchases, cash-out, prizes, deposit or withdrawal claims. |
| Patchbay | Exploring local CLI agents and inspectable plugins; an illustrated write request stays pending approval. | `docs/prds/03-local-agent-harness.md` §5; §6 F04–F05; §7 Trust; Session Seven §11 Patchbay row | none | concept | Local CLI, not a dashboard or remote-service integration. The film’s explicit pending-write pause comes from Session Seven §11. It is an unexecuted illustrative request, not a claim that the read-only Scout plugin writes files or that the host sandboxes plugins. |
| Sidekick | Exploring supervised browser actions: a visible plan, an illustrated action and an approval pause. | `docs/prds/04-chrome-agent-sidepanel.md` §1; §5 Form; §6 P0-F4–F6; Session Seven §11 Sidekick row | none | concept | Supervised plan/action/approval illustration. Consequential submission stays pending; no live-extension proof, universal autonomy, approval-free completion, or verified live-site outcome. |
| TetherTerm | Exploring ongoing terminal control: illustrated input and output retain the same session and history. | `docs/prds/05-mcp-terminal-controller.md` §1; §4 Developer; §5; §9 terminal_write/terminal_read; Session Seven §11 TetherTerm row | none | concept | One fixed fake session ID and retained transcript illustrate ongoing control. No dashboard, real PTY/client connection proof, durable-history guarantee, or new-session-per-command behavior. |
| Glassroom | Exploring two-person encrypted text through paired messages and an illustrative ciphertext drawing. | `docs/prds/06-p2p-encrypted-chat.md` §1; §6 F01/F03/F04/F07; §10 threat-model boundaries; Session Seven §10–11 | none | concept | Exactly two paired views; ciphertext is an illustration, not output of encryption. No anonymity, untraceability, endpoint protection, audited security, operating encryption, or live delivery claim. |
| Outro | Built by Jia Wei Ng. What next? | `docs/prds/07-promo-video.md` §11, outro row; §9 framing status | none | omitted | Exact requested builder credit; six independent tiles. Credit does not claim that the six products were released or that Opus authored this implementation. |

## Locked captions and timing

The table captions remain verbatim after replacing each explicit line break with a space. Line breaks are locked in the records and checked by the validator. Each scene has one fixed caption covering its entire end-exclusive scene interval: intro `[0,180)`, Caret `[180,420)`, Flopside `[420,660)`, Patchbay `[660,900)`, Sidekick `[900,1140)`, TetherTerm `[1140,1380)`, Glassroom `[1380,1620)`, outro `[1620,1800)`. Every hold is 180 or 240 frames, exceeds 60 frames, and uses at most two lines of at most 38 characters each.

## Evidence and validation boundaries

`prototype` requires a nonempty string `evidenceRef`; operational/release wording is denied unless both prototype status and that reference are present. The dependency-free validator checks the existence of a reference, not the referenced evidence’s contents. Any future promotion requires a reviewer to inspect product-specific evidence and update this table; an arbitrary string or an illustration is not implementation evidence. Absolute-security and out-of-scope voice-control/money promises remain prohibited even on prototypes. No product is promoted here.

All fixtures are explicitly marked fake and sanitized. Patchbay’s write is pending and unexecuted, Sidekick’s submission is pending, TetherTerm uses `demo-session-007` throughout its illustrative transcript, and Glassroom’s ciphertext string is labeled a drawing rather than a cryptographic test vector. No external API/model was called.

## Builder check evidence

`qa/timeline-validation.txt` contains the actual default command, four required temporary-fixture CLI runs with named violations and exit codes, and the timeline test suite output. The four malformed JSON copies are created under `os.tmpdir()` by `apps/video/tests/timeline.test.js` and deleted after the tests; they are not film deliverables. Independent acceptance verification has not been performed by this builder.

## Authoring provenance

Authored by Manus swarm agent builder #153, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). This data/validation work does not satisfy the blocked Opus authoring gate in #152. See `authoring/reviews.md` for the issue-specific record.
