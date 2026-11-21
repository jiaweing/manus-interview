# #154 — Representative benchmark review

**Reviewer/author:** Manus swarm agent b154/builder. Authored by Manus swarm agent b154/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). This is a builder self-check, not independent verification or acceptance of the blocked #152 authoring gate.

## Scope and measurements

`apps/video/src/benchmark/BenchmarkScene.jsx` is a committed, throwaway feasibility fixture, not a film scene. The separate `src/benchmark/index.js` entry registers only `Benchmark` at **1920×1080, 30 fps, 240 frames**. The film entry/root are untouched. The actual normal-entry composition listing in `qa/benchmark-hero-registry.txt` shows exactly `Hero 30 1920x1080 1800 (60.00 sec)`; it has one unrelated scaffold base-tsconfig warning, not a browser/render error.

Command: `bun run benchmark:scene --compare` (exit 0). Both runs are actual complete `renderMedia` invocations, including all frames and H.264 encoding; bundle/select/stills are timed separately. The accepted iteration's measurements and toolchain identity are in `qa/benchmark.json`; both concurrency runs are preserved in `runs`, with required concurrency 2 at top level.

| Iteration/run | Frames | Errors | Concurrency | CPUs | Start load average (1m/5m/15m) | Wall seconds | Seconds/frame | Projected 1,800-frame seconds | Projected minutes |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Initial baseline, text contrast correction needed | 240 | 0 | 2 | 6 | 0.78 / 0.30 / 0.22 | 72.441 | 0.301839 | 543.310 | 9.055 |
| Initial comparison | 240 | 0 | 4 | 6 | 5.10 / 1.78 / 0.75 | 82.149 | 0.342288 | 616.119 | 10.269 |
| **Accepted baseline** | **240** | **0** | **2** | **6** | **0.74 / 1.56 / 1.07** | **84.481** | **0.352006** | **633.611** | **10.560** |
| Accepted comparison, unchanged fixture | 240 | 0 | 4 | 6 | 5.45 / 2.84 / 1.56 | 78.816 | 0.328400 | 591.120 | 9.852 |

Accepted benchmark machine-wide initial load was **0.39 / 1.63 / 1.06** at `2026-11-21T14:30:33.708Z`. Other agents share this six-CPU machine: the load/confounding differences mean this is not an isolated scaling study. Keep concurrency 2 for subsequent shared-machine renders. Pinned checks passed: Bun 1.4.5; Remotion/CLI/bundler/renderer 4.0.545; React 19.2.0; `/usr/bin/chromium` 156.0.8078.73 with `gl: swangle`; bundled Inter 700 from `@fontsource/inter@5.2.8`, SIL OFL 1.1. Actual verified versions and the font SHA-256 are embedded in the report.

The initial measurements are retained in `qa/benchmark-first-run.json` and `qa/benchmark-first-run.txt`. Initial feasibility **passed**, but a numeric contrast audit found secondary #71717A text on #F4F4F5 at **4.3969:1**, below the PRD's 4.5:1 minimum. The initial reading decision was therefore withdrawn. I changed only that secondary text fill to #18181B, retaining **48px text, labels, all holds, layers, and identical motion**, then measured both runs again. This was a readability correction, not a failed timing decision or performance simplification.

## Reading-hold and settled-result inspection

I opened all three accepted full-resolution PNGs with the image-reading tool after the corrected render:

| Still | Inspected result |
| --- | --- |
| `qa/benchmark/frame-030.png` | Initial hold: capsule, offset silhouette, restrained Sun/Mint exterior scenery, interface shadow and neutral layering, both labels, and the two-line caption are visible and unclipped. |
| `qa/benchmark/frame-150.png` | Settled action-result: the interface group moved 80px left into its final position. Text remains readable; caption and labels are unchanged. No borders, outlines, divider strokes, interface accent colors, Send control, or text overlap. |
| `qa/benchmark/frame-239.png` | Nonempty final held result: settled layout and all required text remain readable through the last frame. Matches frame 150 by visual inspection, not a claimed determinism/pixel test. |

**Accepted reading decision: PASS.** The caption is pulled from the locked Caret record in `src/timeline.js`: `Caret — Speak.` / `Text at your caret.` at **60px**, exactly two lines each under 38 characters. Persistent `Illustrated UI` and `Concept` labels are **48px**; all interface text is also 48px. Caption/labels remain fixed for **all 240 frames**, exceeding the 60-frame minimum. Essential text is within the 5% safe area (96px horizontal, 54px vertical). Numeric contrast is **15.0106:1** for Ink/Paper captions/labels and **16.1184:1** for #18181B/#F4F4F5 text. The interface uses only allowed monochrome surfaces/text with 10px surface radii and no strokes; colors remain exterior.

Bundled Inter loads with CSS `@font-face`/`staticFile` and `document.fonts.load` guarded by `delayRender`/`continueRender`. No new dependencies, remote fonts/images, model calls, or music requests are used.

**Motion decision: PASS for bounded frame-derived movement and endpoint readability.** A single clamped `interpolate(frame, [60,90], [80,0])` group translation gives a 60-frame initial hold, 30-frame movement, and 150-frame final hold. Captions and labels never move. No continuous camera movement, flashing, articulated rig, timers, unseeded randomness, or mutable simulation exists. This workload is not Caret's shortcut/listening/insertion implementation: illustrated inserted text is already present at both holds. Normal-speed perceived motion was **not watched** because temporary MP4s are deleted; this decision covers inspected endpoints and source timing only.

## Six-hour feasibility comparison

The PRD window started **2026-11-21 21:44 +08:00**, ending **2026-11-22 03:44 +08:00**. Current accepted-review clock was **2026-11-21T14:34:16.510Z** (**22:34:16.510 +08:00**). The clock helper computed **309.724833 build minutes remaining**, saved in `qa/benchmark-build-window.json`.

**PASS: accepted baseline 10.560 projected full-render minutes ≤ 309.725 remaining build minutes.** Accepted concurrency-4 comparison also fits: **9.852 ≤ 309.725**. Bundle/select overhead measured **37.289s / 1.374s**, separate from rendering; adding that once still leaves a wide margin. All initial and accepted timing projections fit, so no failed feasibility decision or motion/layer simplification was necessary.

**Accepted decision:** retain the simple flat/shadowed, one-translation complexity budget, concurrency 2, ≥48px captions/labels, and full reading holds. Linear 1,800/240 projection estimates a similar scene workload; it is not a measured full-film duration or guarantee under later load/audio/scene complexity. If a later workload no longer fits, simplify motion/layers and remeasure—not typography, labels, or holds.

## Evidence and limits

`qa/benchmark-verification.txt` captures the accepted measured command; `qa/benchmark-toolchain.txt` captures pinned verification. `qa/benchmark/browser-log.json` captures console/runtime page events (empty: zero errors). Remotion 4.0.545 forwards uncaught Runtime page exceptions into `onBrowserLog(type:error)`; renderer rejections are counted too. Temporary H.264 outputs and bundles are under `os.tmpdir()` and deleted in `finally`: **no benchmark MP4 remains or is committed**. Only three internal-review PNGs are retained.

`bun test apps/video/tests/benchmark.test.js` passed **8 tests, 63 assertions, exit 0** without invoking Chromium or re-rendering (`qa/benchmark-tests.txt`). Tests exercise projection/clock/decision helpers, pure-helper serialization to temporary `qa/benchmark.json`, the measured report shape, entry isolation/locked caption, and a numeric contrast guard. Full-suite output is kept in `qa/benchmark-full-suite.txt` and refreshed after rebasing.

Independent clean-worktree verification is pending. Real Claude authoring is **not run: no key**. This fixture does not claim full-film render/audio/scene coverage, determinism, or normal-speed watch-through approval.
