# #156 — Intro / credited independent-tile outro review

**Author/reviewer:** Manus swarm agent b156/builder. Authored by Manus swarm agent b156/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No Opus request, generation id or accepted model patch exists. The Lead waived the #152 dependency for this run; that does not satisfy the blocked model-authoring gate.

**Review decision: PASS for builder implementation self-check.** This is not independent acceptance verification, a model-gate PASS, or full-film approval. Independent clean-worktree verification remains pending. Authoring reference: [`authoring/reviews.md`, section `## #156`](../authoring/reviews.md#156).

## Acceptance criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| Intro `[0,180)` and outro `[1620,1800)` each occupy exactly 180 frames and show Caret, Flopside, Patchbay, Sidekick, TetherTerm and Glassroom without suggesting a connected suite. | PASS | Immutable timeline intervals and named component exports tested. All eight native 1920×1080 PNG files below opened and visually inspected. Each card has its own rounded body, offset silhouette and soft shadow; whitespace separates all six. There are no linking lines, arrows, shared hubs, enclosing interface panels or integration claims. |
| Exact opening caption `Six ideas. One build session.` and exact builder credit `Built by Jia Wei Ng. What next?` are readable within caption limits and fixed for at least 60 frames. | PASS | SceneFrame supplies timeline captions unchanged for all 180 local frames per scene. Both are one line, under 38 characters, 60px/700, inside the fixed safe caption plate. Tests assert text and identical caption geometry for all 360 frames. Frame 150/179 and 1770/1799 PNG pairs are byte-identical, corroborating their held end states. |
| Both scenes use the same Pip/style, omit product readiness status, and the final film frame contains the credited outro rather than emptiness. | PASS | Both import the shared Pip and use scale 0.64, shared font, palette, silhouette/shadow primitives and identical tile fixtures. Pointing/happy versus waving are shared static poses, not a different mascot or rig. All-frame presentation tests assert no labels; source absence checks exclude readiness/interface labels. `qa/stills/frame-1799.png` visibly contains Pip, six separate named cards and exact credit. |
| Scenery cards use Paper/Ink/Sun/Mint, readable names ≥48px, and ≥4.5:1 contrast. | PASS | Each card is 496×250 SVG px, with unscaled centered 56px/700 bundled Inter. These are scenery, not product interfaces, so they deliberately use the exterior palette. Ink/Paper = 15.010597:1; Ink/Sun = 11.085088:1; Ink/Mint = 9.129745:1. Paper/Ink has the same ratio as Ink/Paper. Every text/background pair is tested. No name clipping/overflow or caption overlap observed, including TetherTerm. |
| Entrances land on beats and both scenes settle with ≥60-frame end holds. | PASS | Intro starts at local 0,15,30,45,60,75 with 15-frame translations; Pip's bounded whole-body translation starts 45 and ends 90. All settle at 90; `[90,180)` is a 90-frame hold. Outro starts at 0,0,15,15,30,30, each lasting 15 frames; Pip settles at 30. All settle at 45 (absolute 1665); `[1665,1800)` is a 135-frame hold. Tests inspect every hold frame. |
| No render-time network, wall-clock/random/timer motion, generated imagery, camera movement, or unrelated functionality. | PASS | Pure exported frame helpers call shared anim.js `beat`, `bar` and `translateIn`. Source absence checks and real pinned Chromium smoke pass. No new dependencies, image assets, audio events, root scripts, shared primitives, timeline or scene-registry changes. |

## Reviewed PNGs

Paths are relative to `products/session-seven/`. Only these eight reviewed PNGs are changed/added by this issue; other existing evidence is left untouched.

| Frame | Inspected PNG | Result and observation |
| --- | --- | --- |
| 0 | `qa/stills/frame-0000.png` | PASS — Nonempty opening; all six loose, already-readable scenery cards plus pointing Pip and exact opening caption. Cards are intentionally visible before their translations begin, so the opening never hides a name. |
| 30 | `qa/stills/frame-0030.png` | PASS — Caret and Flopside have landed; Patchbay starts its entrance, remaining cards wait visibly. Six correctly spelled readable names, no labels or linking geometry. |
| 150 | `qa/stills/frame-0150.png` | PASS — Settled 3×2 grid, happy Pip beside the lower row, exact fixed opening caption. All cards readable and separate. |
| 179 | `qa/stills/frame-0179.png` | PASS — Nonempty final intro state, identical to frame 150. No premature exit/fade. |
| 1620 | `qa/stills/frame-1620.png` | PASS — First outro is already nonempty with all six independent cards, shared waving Pip and exact builder credit. |
| 1650 | `qa/stills/frame-1650.png` | PASS — First four cards landed, last two begin their own bounded entrances. Whitespace visibly separates the cards; all names and credit readable. |
| 1770 | `qa/stills/frame-1770.png` | PASS — Six fully settled independent tiles, waving Pip, exact credit; no lines/arrows/hub and no product-status text. |
| 1799 | `qa/stills/frame-1799.png` | PASS — Credited, nonempty last frame, identical to frame 1770. No fade to blank. |

The 3×2 cards lie at x=272/792/1312, y=236/518 in the 1728×566 illustration area. Final horizontal gaps are 24px and the row gap is 32px. Small independently staggered translations stay inside the illustration rectangle and never overlap card bodies; tests check every local frame. Pip is positioned in a dedicated left rail, clear of names and the caption. Seeded backdrop accents belong to shared scenery, not interface interiors or connections between products.

## Exact event frames

There is **no primary action blip** in intro or outro (`actionBlip: null`). Intro tile starts are absolute 0,15,30,45,60,75; arrivals are 15,30,45,60,75,90. Pip moves from local 45 to 90, then chooses the shared happy pose. Outro tile starts are absolute 1620,1620,1635,1635,1650,1650; arrivals are 1635,1635,1650,1650,1665,1665. Waving Pip enters from 1620 to 1650 and holds. Captions never animate.

## Commands and evidence

- `bun run preview:stills --frames 0,30,150,179,1620,1650,1770,1799`: **exit 0; STILLS ok count=8**. `qa/intro-outro-verification.txt`. Bundle 46.546s, renders 25.907s, total 76.434s under concurrent swarm load; concurrency 1.
- `bun test apps/video/tests/intro-outro.test.js`: **8 pass, 0 fail, 19115 assertions; exit 0**. `qa/intro-outro-tests.txt`. Includes all-frame caption/no-status checks, exact names/ranges, contrast/geometry/independence, beat timing and ≥60-frame holds, deterministic helpers, prohibited source/text patterns and a real three-frame smoke test.
- Real smoke uses shared preview CLI with pinned local Chromium; frames 0,150,1799 render as native 1920×1080 PNGs. Completed in 12.797s, guarded by a 90s Bun deadline and 85s subprocess timeout; temporary files cleaned and not committed.
- Native dimensions, contrast and byte-identical held-pair checks: `qa/intro-outro-metrics.txt`.
- `bun test apps/video/tests` after rebasing on `origin/main`: **159 pass, 0 fail, 86482 assertions across 8 files; 52.01s; exit 0**. `qa/intro-outro-full-suite.txt`. No flaky retry was required; the intro/outro real smoke completed in 18.777s under this run's load.

**Unverified / caveats:** independent clean-worktree acceptance and normal-speed full-film playback are left to the verifier/integrator; no full render was run by this builder. Real Opus authoring remains **not run: no key**, and #152 remains blocked. No issue labels, merges or closures were performed.
