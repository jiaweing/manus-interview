# #159 — Patchbay CLI hold/result review

**Author/reviewer:** authored by Manus swarm agent b159/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No model request, generation id or Opus-authored patch exists. The Lead's dependency waiver permits Manus-authored scene work; it does not satisfy blocked #152.

## Builder self-check decision

**PASS — scoped scene implementation and visual self-checks.** This is not independent acceptance verification. Opened all five native 1920×1080 PNGs listed below and inspected the final CLI at unscaled 1370×508 detail size, including the 48px approval text and block caret gap. Temporary crop-only inspection aids were stored under `/tmp/b159-{cli,caption}-native.png`, not committed or used as visual assets. Only the five issue-requested PNGs are committed.

| Absolute / local frame | PNG, relative to product root | Review |
| --- | --- | --- |
| 660 / 0 | `qa/stills/patchbay/frame-0660.png` | **PASS:** one dark CLI with `Local demo · not executed`; no GUI panels. Pip remains outside the CLI. Exact two-line caption and persistent Illustrated UI / Concept labels are present and unclipped. |
| 690 / 30 | `qa/stills/patchbay/frame-0690.png` | **PASS:** `› patchbay plugin list` appears as the discovery command. Short text fits the CLI at native 48px; no result is prematurely displayed. |
| 780 / 120 | `qa/stills/patchbay/frame-0780.png` | **PASS:** the inspectable result begins exactly here: `Plugin: workspace-scout` and `read-only workspace search`. No agent-execution or remote-integration proof is depicted. |
| 870 / 210 | `qa/stills/patchbay/frame-0870.png` | **PASS:** `Write request: sample-note.txt` followed by bold `Write paused: approve? [y/N]` and a visible block caret. No completed write or check icon. Caption and labels remain readable. |
| 899 / 239 | `qa/stills/patchbay/frame-0899.png` | **PASS:** the same pending approval state remains at the last end-exclusive scene frame. A visible block caret and no answered approval, completion output or agent-running proof. |

## Exact event frames and readable holds

The shared Hero Sequence is `[660,900)`. All event constants and drawing state use scene-local frames:

| Event | Local | Absolute | Hold / behavior |
| --- | --- | --- | --- |
| Non-operational demo header | 0 | 660 | Remains visible for the full scene. |
| Discovery command | 30 | 690 | Remains visible through 899. |
| Primary action: inspectable plugin result | **120** | **780** | Both name and one capability line start via `enter(frame, at, 0)` exactly at 120, with no invisible first action frame. Remain visible for 120 frames, matching the #166 blip convention. |
| Illustrative write request | 165 | 825 | Appears one beat before approval pause, remaining visible through 899. |
| Awaiting approval | 180 | 840 | Explicit default-negative `[y/N]` question remains continuously visible for the final 60 frames / two seconds. No branch accepts it. |
| Caret blink | 180 onward | 840 onward | Deterministic three-beat cycle, two beats visible / one beat hidden, with a one-beat phase offset. It is visible at local 210 and 239; hidden at local 195. Only the block blinks, never the approval text. |

**PASS — CLI only:** exactly one shared `Cli` surface; no Window, Panel, Row, Button, dashboard, split GUI or interior divider. Caption/readiness plates belong to the unchanged shared SceneFrame, not product GUI.

**PASS — pending-write honesty:** the sanitized Scout name/capability and sample-note request are adapted from `FIXTURES.patchbay`. The write request is separate from Scout's read-only capability; this does not imply Scout can write. `Local demo · not executed`, Illustrated UI and Concept distinguish an illustrative request from operational evidence. No filesystem, model, network or plugin call is made; no containment/sandbox promise, remote-service integration or functioning-agent proof is asserted. No `written`, `done`, `saved`, `success` or write check glyph occurs in the scene output.

**PASS — caption/labels and legibility:** shared SceneFrame supplies exactly `Patchbay — Local agents.\nInspectable plugins.` at 60px and Illustrated UI / Concept at 48px for all 240 local frames, checked by unit tests. The CLI is x=410, y=252, w=1370, h=508, wholly within the 1728×566 illustration rect. It has six manually limited lines (≤30 characters), 48px text, 68px baseline spacing, and no scale reduction. Final approval uses Inter 600; bundled glyph advance measured at 686.1796875px, with caret x=752 after text x=40, leaving a clear gap. No overflow, overlap or caption/label dropout was seen. CLI colors are #18181B and #FAFAFA with shared AA-supported contrast; Sun/Mint belong only to outside scenery/Pip. Interfaces use no strokes, borders, outlines or dividers.

## Commands and retained evidence

From `products/session-seven/`, using Bun 1.4.5, pinned Remotion 4.0.545, bundled Inter, and `/usr/bin/chromium`; shared preview tool uses one reused browser and concurrency 1:

- `bun test apps/video/tests/patchbay.test.js`: **exit 0, 11 pass, 0 fail, 2432 assertions, 8.61s**. `qa/patchbay-tests.txt`. Includes source/absence checks, exact first-visible frames, caption/label checks over every scene frame, immutable shuffled-state checks, geometry/contrast checks, and real three-frame smoke at 780/870/899 with a 90s test deadline and an 85s subprocess deadline. Smoke completed in 8.238s; temporary PNGs removed.
- `bun run preview:stills --scene patchbay --frames 660,690,780,870,899`: **exit 0, STILLS ok count=5**. `qa/patchbay-verification.txt`. Bundle 3.998s, renders 4.548s, total 10.189s, concurrency 1. Exactly the five referenced PNGs, each 1920×1080.
- After `git fetch origin && git rebase origin/main`, `bun test apps/video/tests`: **exit 0, 162 pass, 0 fail, 69799 assertions, 41.46s**, across eight files. `qa/patchbay-full-suite.txt`. Includes the real Patchbay smoke (11.095s) and shared Hero smoke; no full-film render is run in this scope.

The initial focused suite and five still renders both passed, but the surrounding inline shell wrapper failed to capture exit-code variables and itself exited 2. Its original outputs remain in `/tmp/b159-first-{tests,verification}.txt`. A file-based Bash wrapper reran both commands and recorded the successful exit codes above. This was evidence-wrapper repair, not a hidden scene or test failure.

## Unverified / out of scope

Independent clean-worktree acceptance remains for the assigned verifier; this builder has not labeled, merged or closed the issue. Normal-speed full-film playback, final audio alignment/mix, final MP4 and whole-film decoded-pixel determinism are later issues and were not run. Actual product operations and provider access are not asserted. Real authoring-API check: **not run: no key**; no Opus gate completion claimed.
