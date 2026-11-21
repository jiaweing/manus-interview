# #157 — Caret desktop dictation illustration review

**Reviewer/author:** Manus swarm agent b157/builder. This is a builder implementation self-check, not independent verification, a native Windows test, or release acceptance. Authored by Manus swarm agent b157/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No model request, generation id, or accepted Opus-authored patch exists; #152 remains blocked. The Lead's dependency waiver permits this scoped Manus-authored scene, not a PASS on the model gate.

## Scoped decision

**PASS — builder self-check for the Caret illustration and its tests.** Replaced only `apps/video/src/scenes/CaretScene.jsx`; added `apps/video/tests/caret.test.js`, this review, command logs, and the five referenced PNGs. No shared primitives, timeline claims, registry, dependencies, or audio were changed.

Read contracts: `docs/prds/07-promo-video.md` §§6–11 / Appendix A; `docs/prds/01-desktop-voice-input.md` §§1, 3, 6 F05–F06; `qa/claims-audit.md` Caret row; `qa/primitives-review.md`; wave-five scene/API/action-frame requirements. The shortened fixture **Hello team** is invented and sanitized, never a transcript. The approved shortcut remains **Ctrl+Alt+Space**.

## Exact events and holds

| Local frames | Absolute Hero frames | Illustrated event |
| --- | --- | --- |
| `[0,30)` | `[180,210)` | Desktop draft field, empty block caret, keyboard icon and Ctrl / Alt / Space keycaps. Pip is neutral. |
| `[30,120)` | `[210,300)` | Listening begins at exactly local 30. Mic icon, Listening label, static listening Pip pose and thought bubble “Hello team.” Meter heights are seeded, discrete beat buckets (15-frame steps), not continuously animated/pulsing. |
| `120` | `300` | **Primary action: text insertion starts exactly here.** `enter(frame, CARET_ACTION_FRAME, 0)` changes the field from empty to the whole short fixture, like a single illustrated clipboard insertion. The block caret moves beside it. No delayed start or pre-action text. |
| `[120,135)` | `[300,315)` | The old thought bubble translates a small bounded distance toward the field and fades; the inserted field text stays fully readable. This is one insertion event, not delivery. |
| `[135,240)` | `[315,420)` | Thought bubble gone. Field text stays unchanged through the last scene frame. Reading hold is 105 frames / 3.5 seconds after the bubble settles; inserted field text itself holds 120 frames / 4 seconds. |

The caret's block visibility is computed solely from `frame % 60 < 45`: on for 45 frames, off for 15, with no timer. The caption, product labels, fixture text and keycaps never blink. Listening bars use five neutral filled shapes with heights from `{18,30,42,54}` and a PRNG recreated from `SEEDS.caret + floor(frame / 15)` on every render; shuffled/repeated evaluations are identical. No camera motion or ongoing positional motion; bubble translation settles at local 135.

## Native PNG inspection

Opened and looked at **each native 1920×1080 PNG** using the image-reading tool. All text is readable, unclipped, and clear of the persistent labels and caption plate. Only these five reviewed PNGs are committed for this issue.

| Result | PNG relative to product root | Observation |
| --- | --- | --- |
| PASS | `qa/stills/caret/frame-0180.png` | Empty desktop draft field and visible block caret. Ctrl + Alt + Space appears as filled keycaps with a keyboard glyph; there is no action button. Neutral Pip sits outside the monochrome window. |
| PASS | `qa/stills/caret/frame-0210.png` | Listening label and mic glyph, five stepwise neutral listening bars, listening Pip pose, and “Hello team” in the thought bubble. Field is still empty. |
| PASS | `qa/stills/caret/frame-0300.png` | Exact action frame: “Hello team” now appears in the field beside the block caret, while the previous thought bubble starts its short fade/transfer. Header says Inserted, not any delivery state. |
| PASS | `qa/stills/caret/frame-0390.png` | Settled reading hold: thought bubble gone; “Hello team” beside a visible black block caret. No Send control, arrow, submitted/sent state, or sending instruction. |
| PASS | `qa/stills/caret/frame-0419.png` | Final in-range frame retains the inserted fixture, unchanged window/keycaps, exact caption and both labels. The block caret is in its deliberate blink-off interval; text does not blink. No delivery state appears at the cut. |

## Acceptance and absence checks

| Builder check | Result | Evidence |
| --- | --- | --- |
| Desktop shortcut → listening → text inserted in `[180,420)` | PASS | Ordered five PNGs; pure tests check 29/30, 119/120 and 134/135 boundaries, no insertion before 120, insertion held through 239. |
| Primary illustrated action at local 120 / absolute 300 | PASS | Exported `CARET_ACTION_FRAME = bar(2)` and zero-duration `enter` gate; frame-0300 PNG; action-frame unit test. |
| No Send button/arrow, sent-message state, “Enter to send,” or submission action | PASS | Scene-only source grep test excludes those words/patterns and any Button primitive; all five PNGs visually checked. The keyboard glyph is a shortcut cue, never a send control. |
| No universal voice control or “control your computer” claim | PASS | Scene-only claim absence test; exact claim stays “Exploring desktop dictation…” in `getScenePresentation`; no operational product evidence is asserted. |
| Exact product/caption with locked line breaks | PASS | Shared `SceneFrame sceneId="caret"`, unchanged caption **Caret — Speak.\nText at your caret.**; unit test checks all 240 local frames; all PNGs show the same two-line caption. |
| Persistent Illustrated UI / Concept qualification | PASS | `getScenePresentation("caret", frame)` checked for every frame 0..239, unchanged `status: concept` / `evidenceRef: null`; labels visible in all five PNGs. |
| Short sanitized fixture, borderless monochrome interior | PASS | “Hello team,” shared Window/Panel/TextLine/Icon/Caret primitives, neutral meter fills. No external assets, strokes, borders, outlines or dividers in scene source. Pip/scenery colors stay outside the UI. |
| Legibility, safe bounds, stable reading text | PASS | UI uses unscaled 48px TextLine; caption/labels inherit 60px/48px shared defaults. Window x=660..1700, y=278..730; bubble and Pip fit the illustration rect and avoid y=54..192 labels / y=826..1026 caption. Every PNG opened for overlap/overflow inspection. |
| Frame-only determinism and no continuous pulse | PASS | Pure meter/state tests, seeded beat buckets, slow frame-only caret blink, bounded shared enter/translateIn. Source excludes wall clocks, unseeded randomness, timers, network, mutable hooks and SVG/CSS animation. |
| Honest scoped author/review record | PASS | This addendum and `authoring/reviews.md` #157 identify Manus authorship and the unresolved Opus prerequisite. No accepted model patch is fabricated. |

## Commands and retained evidence

- `bun run preview:stills --scene caret --frames 180,210,300,390,419`: five PNGs and `STILLS ok count=5`; complete final output/exit status in `qa/caret-stills-verification.txt`.
- `bun test apps/video/tests/caret.test.js`: **9 pass, 0 fail, 2,282 assertions**, 9.33s; real three-frame scoped smoke **8.973s, exit 0**, under the 90-second deadline. Output: `qa/caret-tests.txt`. Temporary smoke PNGs are deleted by the test and are not deliverables.
- `bun test apps/video/tests`: post-rebase full-suite output is retained in `qa/caret-full-suite.txt`.

The first five-frame renderer succeeded and printed `STILLS ok count=5`, but its surrounding terminal exit-capture wrapper failed (empty PIPESTATUS variable, wrapper exit 2). It was not represented as an exit-0 verification. The command was rerun with an explicit Bash/pipefail wrapper and the final complete log is retained above. Initial wrapper output: `/tmp/b157-first-stills-wrapper.txt`, temporary diagnostic only.

**Unverified/out of scope:** independent clean-worktree verifier, normal-speed scene/full-film playback, full-film decoded-pixel determinism, audio synchronization/mastering, actual hotkey/microphone/clipboard behavior on Windows, provider/model access. Real API checks **not run: no key**. No `status:verified` label, merge or issue closure by this builder.

### Post-rebase suite result

**PASS:** `bun test apps/video/tests` after rebasing onto `origin/main`: **160 pass, 0 fail, 69,651 assertions**, eight files, 42.10s, **exit 0**. The full-suite Caret smoke rendered three native PNGs in 11.065s (exit 0). Retained complete output: `qa/caret-full-suite.txt`. Final exact five-frame preview: bundle 3.015s, renders 4.506s, total 8.642s, concurrency 1, **STILLS ok count=5 / exit 0**.
