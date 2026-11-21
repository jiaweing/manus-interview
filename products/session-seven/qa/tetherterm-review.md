# #161 — TetherTerm persistent terminal review

**Reviewer:** Manus swarm agent b161/builder, implementation self-check only. Independent clean-worktree verification remains pending; this review does not apply `status:verified`, approve a release, merge, or close the issue.

**Authoring:** authored by Manus swarm agent b161/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No model request, generation id or accepted model patch exists. The Lead's dependency waiver permits this work but does not satisfy the blocked #152 Opus authoring gate. Reviewed source and authoring reference: `apps/video/src/scenes/TetherTermScene.jsx` and `authoring/reviews.md` §#161.

## Decision and scope

**PASS — builder scene checks.** Replaced only the assigned TetherTerm scene and added its tests/review artifacts. All five final native 1920×1080 PNGs below were opened and visually inspected. The illustration is one shared `Cli` terminal surface, with one fixed visible session identifier and retained earlier transcript lines. There is no dashboard, separate command window, operational-connection proof, or real terminal execution. The persistent **Illustrated UI / Concept** labels preserve the intended framing.

The transcript comes directly from the sanitized, immutable `FIXTURES.tetherterm` data. It illustrates a Python session previously retaining `sample = 6`, then accepting `sample + 1` and returning `7`. Neither this scene nor the preview command runs those expressions. Source PRDs: `docs/prds/07-promo-video.md` §§6–11 / Appendix A; `docs/prds/05-mcp-terminal-controller.md` §§1, 4 Developer, 5 and 9. Claims boundary: `qa/claims-audit.md` TetherTerm row. Retained history describes the illustration, not a durable-history guarantee.

## Required 1170 / 1260 / 1350 comparison

All coordinates below are global SVG pixels. The shared terminal remains at `(580,242)` with size `1210×536`; it has no entrance, scrolling, clearing, scaling, or movement at any frame. Its session identifier **demo-session-007** has the same text origin `(620,320)` in every frame, including both endpoints.

| Absolute frame / local frame | Visible identifier and retained history | Input / output | Builder check |
| --- | --- | --- | --- |
| [1170 / 30](stills/tetherterm/frame-1170.png) | `demo-session-007`; `>>> sample = 6`, `>>> sample * 7`, `42` retained at baseline y=388,456,524 | Waiting `>>>` at `(620,592)`; no new input/output yet | **PASS:** reading hold, one terminal, same identifier, readable history |
| [1260 / 120](stills/tetherterm/frame-1260.png) | Identical identifier at `(620,320)` and all three history lines at unchanged coordinates | `>>> sample + 1` first appears at `(620,592)`; its output is not shown prematurely | **PASS:** input accepted by the existing illustrated session exactly on the action frame |
| [1350 / 210](stills/tetherterm/frame-1350.png) | Identical identifier and retained history; accepted input remains visible | Matching `7` at `(620,660)` and next `>>>` at `(620,728)` in that same terminal | **PASS:** corresponding outcome, no replacement session/window or lost history |

Additional required frames:

- [1140 / 0](stills/tetherterm/frame-1140.png): **PASS**, terminal/identifier/history/caption/labels are already fully visible on the first scene frame, matching the reading hold.
- [1379 / 239](stills/tetherterm/frame-1379.png): **PASS**, input, output, next prompt, identifier and all earlier history remain fully visible through the end-exclusive cut.

## Exact event frames and typography

- **Input acceptance starts at local 120 / absolute 1260**, using `enter(frame, ACTION_FRAME, 0)` with `ACTION_FRAME = beat(8)`. Zero-duration step means the complete input is legible immediately on that frame. Local 119 has only the waiting prompt.
- **Output starts at local 180 / absolute 1320**, using `enter(frame, OUTPUT_FRAME, 0)` with `OUTPUT_FRAME = beat(12)`. Result and next prompt hold for local `[180,240)` (60 frames / two seconds); they are visible by required local 210 / absolute 1350. No full-film or extra output still is claimed for absolute 1320; pure state/markup tests cover that exact boundary.
- **PASS:** caption remains exactly `TetherTerm — One terminal.\nOngoing control.` at 60px with its locked two-line wrapping. Persistent label text is 48px; the terminal's short text is 48px (header 600 weight), unscaled.
- **PASS:** no overlap or clipping in any inspected PNG. Terminal geometry fits illustration bounds x=96..1824, y=224..790 and stays above the caption plate y=826. Pip remains outside the terminal. The next prompt has a 50px baseline-to-bottom gap.
- **PASS:** terminal interior uses shared #18181B / #FAFAFA contrast, with no borders, outlines, strokes, divider lines, widgets, or colored interior accents. Color is limited to shared scenery/Pip.
- **PASS:** no new-session-per-command, live-connection, terminal-client/PTY validation, durable-history, Send/payment/currency claims. No render-time network, wall clocks, unseeded randomness, timers, external assets or new dependencies.

## Retained command evidence

`qa/tetherterm-verification.txt` records the exact required command and its output:

```text
bun run preview:stills --scene tetherterm --frames 1140,1170,1260,1350,1379
PNG qa/stills/tetherterm/frame-1140.png frame=1140
PNG qa/stills/tetherterm/frame-1170.png frame=1170
PNG qa/stills/tetherterm/frame-1260.png frame=1260
PNG qa/stills/tetherterm/frame-1350.png frame=1350
PNG qa/stills/tetherterm/frame-1379.png frame=1379
TIMING bundle=4.069s renders=15.715s total=23.333s concurrency=1
STILLS ok count=5
EXIT_CODE=0
```

`qa/tetherterm-tests.txt` records `bun test apps/video/tests/tetherterm.test.js`: **10 pass, 0 fail, 3715 assertions, exit 0**. Tests cover all 240 local frames for fixed single identifier, retained history, terminal-only markup, exact caption/labels; action/result boundaries; deterministic repeated/shuffled state and markup; safe short 48px text and contrast; source/visible-text absence checks; strict scene frame parsing; and a real three-frame pinned-Chromium smoke using the shared preview CLI, with an 85-second process timeout and 90-second test deadline. The real smoke passed in 73.604s under shared CPU load, concurrency 1. Temporary smoke PNGs were removed; only the five reviewed issue PNGs are committed.

The full post-rebase command and result are recorded in `qa/tetherterm-full-suite.txt` before pushing. Full-film playback, rendered 240-frame pixel determinism, audio synchronization/mix, final MP4, independent acceptance and real MCP/PTY behavior are not verified by this scene builder. Real model/API check **not run: no key**; blocked #152 remains unresolved.
