# #158 — Flopside scene builder review

**Author/reviewer:** Manus swarm agent b158/builder. Authored by Manus swarm agent b158/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No model request, generation id, or Opus-authored patch exists. These are builder implementation self-checks, **not independent acceptance verification** and not a PASS on the blocked #152 authoring gate.

## Decision and criteria

**PASS — scoped scene implementation.** Read `docs/prds/07-promo-video.md` §11 and Appendix A, `docs/prds/02-multiplayer-web-game.md` §1/§5/F03/F05, and `qa/claims-audit.md`. The scene is an illustrated concept, not an operational poker client, multiplayer server, or proof of implementation. The existing timeline, labels, fixture values, shared primitives and registry are unchanged.

| Criterion | Builder result and evidence |
| --- | --- |
| Two seats and private cards | **PASS.** Player A and Player B are visible throughout `[420,660)`. Each has exactly two `card-back` icons before local frame 180. Frame 450 shows four backed private cards and five public board cards. No private ranks/suits are rendered before the common reveal. Pure markup/state tests check every one of the 240 frames. |
| One common reveal and single result | **PASS.** Both seats reveal together at local **180 / absolute 600**. There is one shared board, one “Shared showdown” heading and one “Player A wins” result; no per-seat conflicting result. Frames 630 and 659 show both revealed hands. The invented A-A versus K-K hands with Q-7-4-J-2 board support the displayed winner. The final state holds 60 frames through absolute 659. |
| Free-chip wording and wager | **PASS.** “Free chips” is present throughout; local **120 / absolute 540** places the first central chips and “40 play chips”, with “20 each”. Both stacks change from 200 to 180 chips. The 40-chip shared wager stays visible during the showdown. Values come from sanitized `FIXTURES.flopside`; no random/live gameplay is simulated. |
| Absence of money/payment cues | **PASS.** Visually checked all five stills. No currency symbols, money amounts, deposit, withdrawal, cash-out, wallet, purchasing or payment controls appear. The unit test greps the **raw scene source including comments** and all 240 rendered table markups for prohibited words/symbols; sentinel examples ensure the matcher actually catches them. |
| Exact caption and readable product name | **PASS.** Fixed locked caption: “Flopside — Friends.” / “Poker. Free chips.”, 60px bundled Inter. It remains readable and unclipped in every reviewed still and is data-checked throughout all 240 frames. |
| Persistent labels | **PASS.** “Illustrated UI” and “Concept” stay visible at the fixed top-left positions throughout the scene; native-size label crop inspection and all-frame `getScenePresentation` tests pass. No readiness/operational claim is invented. |
| Borderless monochrome table | **PASS.** Shared `Window`, `Panel`, `TextLine`, `Icon` and frame/layer primitives; surfaces #FAFAFA/#F4F4F5 and text/icons #18181B. Suit silhouettes are filled SVG paths, including black hearts/diamonds, not colored emoji or stroked drawings. No outlines, borders or dividers. Sun/Mint are only in the inherited exterior scenery/Pip, not table interiors. |
| Reading size/layout and deterministic motion | **PASS.** All table text is native 48px, caption 60px and labels 48px. The table is x400..1780, y244..770 after a 12px entrance; the first-frame table bottom is 782, within illustration y224..790. It never overlaps labels or caption y826..1026. Card faces, chips and result are unclipped. No wall clock, timers, network, unseeded randomness or camera movement; repeated/shuffled markup checks pass. |

## Exact event frames

- Local 0–29 / absolute 420–449: bounded 12px group entrance via `translateIn`; backs and two seats are already visible at 420. It settles at local 30 / absolute 450.
- Local 0–119 / absolute 420–539: private hands, 200 chips per seat, no central wager or result. The public board is a static sanitized illustration.
- **Local 120 / absolute 540:** primary audio-blip action, the wager group becomes visible immediately (not opacity-zero). Both seats contribute the fixture's 20 chips; central 40 play chips appear. `enter(frame, WAGER_FRAME, beat(1))` settles an 18px placement translation by local 135 / absolute 555. No second action blip is requested for the showdown.
- Local 120–179 / absolute 540–599: wager held, all four hole cards still backed.
- **Local 180 / absolute 600:** one discrete common showdown; both hands and the single shared result appear together. This holds through local 239 / absolute 659 (60 frames).

## Reviewed PNGs

Opened all five original 1920×1080 PNGs; then inspected final rerender table crops at unscaled 1:1 size, plus native label/caption crops. Crops under `/tmp/b158-native-*.png` are inspection aids only, not authored assets or committed deliverables.

| Committed PNG (relative to product root) | Native review |
| --- | --- |
| `qa/stills/flopside/frame-0420.png` | **PASS:** first scene frame has both seats, four card backs, free-chip heading, 200-chip stacks and private-state wording. Illustration stays below labels and above caption. |
| `qa/stills/flopside/frame-0450.png` | **PASS:** settled hold, two visible seats with card-back icons; neither private hand has rank/suit faces. Five shared community cards are monochrome and legible. |
| `qa/stills/flopside/frame-0540.png` | **PASS:** first wager frame shows “40 play chips”, “20 each”, two chip silhouettes and 180-chip stacks; all four private cards are still backed. |
| `qa/stills/flopside/frame-0630.png` | **PASS:** both private hands revealed together, shared showdown heading, a single Player A result, retained play-chip wager. All face ranks and suits are monochrome, filled and readable. |
| `qa/stills/flopside/frame-0659.png` | **PASS:** same final shared result and revealed hands, no extra outcome or transition obscuring captions/labels at the end-exclusive boundary. |

## Commands and evidence

- `bun test apps/video/tests/flopside.test.js`: **exit 0, 8 pass, 0 fail, 5648 assertions**, 11.15s. `qa/flopside-tests.txt`. Includes a real pinned-Chromium, shared-preview **three-frame smoke** at 450/540/630: 10.009s under the 90s test deadline; PNG signature, 1920×1080 dimensions, file count and nonempty content checked, temporary files removed.
- `bun run preview:stills --scene flopside --frames 420,450,540,630,659`: **exit 0, STILLS ok count=5**, bundle 3.384s, renders 5.538s, total 10.159s, concurrency 1. `qa/flopside-verification.txt`.
- `bun test apps/video/tests` after `git fetch origin && git rebase origin/main`: **exit 0, 159 pass, 0 fail, 73017 assertions across 8 files**, 42.62s. `qa/flopside-full-suite.txt`. The Flopside three-frame real smoke passes again in 8.417s; all shared primitive, timeline, audio, benchmark and authoring tests pass.

The first command wrapper incorrectly captured Bash pipeline statuses, so it returned a wrapper error despite 8 passing tests and 5 successful PNGs. Original output is retained under `/tmp/b158-initial-flopside-{tests,verification}.txt`; the unchanged implementation was rerun with explicit subprocess exit capture. Only the successful, complete exit-0 evidence above is committed.

**Unverified / out of scope:** independent clean-worktree verifier acceptance; normal-speed full-film playback/audio alignment; final MP4 and whole-film pixel determinism; live multiplayer/game networking; real API/model authoring **not run: no key**. No issue label, merge or closure performed by this builder.
