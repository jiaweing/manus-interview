# Session Seven — Promotional Video PRD

**Builder:** Jia Wei Ng · **Environment:** Manus Studio · **MVP:** 4–6 focused hours.

## 1. Overview

**Session Seven** is one 60-second, 1920×1080, 16:9 cartoon showcase: Caret, Flopside, Patchbay, Sidekick, TetherTerm, and Glassroom. One mascot connects intro, six scenes, and outro. Author visuals through JavaScript/React/SVG in Remotion with Claude Opus 5.5 in Manus Studio. Use validated OpenRouter music or pure-JavaScript synthesis. Captions replace narration; illustrations never imply live demonstrations, integration, or completed releases.

## 2. Problem statement and the original brief

Explain six purposes without presenting animation as implementation evidence. Checklist IDs remain mapped to the revised brief.

- [ ] **R1:** Cover the six named products in one coherent 60-second hero.
- [ ] **R2:** Produce visuals purely through JavaScript; no recordings, editors, external images, or generated video.
- [ ] **R3:** Choose Remotion and explain rejected rendering alternatives.
- [ ] **R4:** Author with Claude Opus 5.5; confirm its exact selectable model ID.
- [ ] **R5:** Define cartoon 2.5D layers, palette, typography, and one simple mascot.
- [ ] **R6:** Illustrate clean black-and-white, borderless product interfaces.
- [ ] **R7:** Specify OpenRouter music, validated boundaries, caching, and JavaScript fallback.
- [ ] **R8:** Use beat-derived timing for one 16:9 deliverable.
- [ ] **R9:** Keep honest prototype labels, requirement tests, QA, and a short build plan.

## 3. Goals and non-goals

Deliver readable names, one input-to-outcome illustration per product, truthful readiness labels, and a reproducible film from source. Demonstrate animation quality and provenance, not operational product proof.

**Explicitly out of scope:** product implementation; product short cuts; portrait or other formats; voiceover/TTS; translations; subtitle-file or caption-free exports; thumbnails; elaborate rigs, choreography, or transitions; generative assets; SFX libraries; publishing automation; accounts, payments, analytics, dashboards, and other product extras.

## 4. Target users and key user stories

**Judge:** Understand six distinct purposes in one viewing; all names, captions, and readiness labels remain readable.

**Builder:** Rebuild a changed scene with `bun run render:hero`, without model access or music regeneration.

**Viewer:** Follow muted using stable captions.

**Collaborator:** Every product scene displays “Illustrated UI” and “Concept” or evidence-supported “Prototype.”

## 5. Core user flows

1. Scaffold the independent project; lock scene records, wording, beat grid, fonts, and sanitized fixtures.
2. Author scoped JavaScript scene components with the specified Claude model; review reading-hold and action-result stills.
3. Attempt the bounded OpenRouter music smoke test if credentials exist; otherwise select the synth immediately.
4. Freeze approved audio and scene data. Validate, render, and inspect the complete hero.
5. Correct affected components, rerun QA, and hand off the MP4 plus source and rebuild instructions.

Missing evidence changes wording and labels, never simulated proof. Failed music access cannot block rendering; missing authoring-model access must be reported rather than silently substituted.

## 6. Functional requirements

All surviving requirements are **P0**:

- **F01:** Validate exactly six product records plus intro/outro, continuous frame ranges, captions, and evidence-backed wording. Covers R1/R9.
- **F02:** Implement the beat table with deterministic Remotion scenes and one mascot. Covers R2/R3/R5/R8.
- **F03:** Render faithful borderless interfaces with burned-in captions and persistent labels. Covers R6/R9.
- **F04:** Use Claude Opus 5.5 for scoped authoring; record the selected model and review changes. Covers R4.
- **F05:** Implement a bounded OpenRouter music adapter, cache accepted audio, and provide offline JavaScript synthesis with only a few action blips. Covers R7.
- **F06:** Deliver one hero MP4, source, lockfile, cached/fallback audio, compact QA results, and README. Covers R1/R9.

## 7. Non-functional requirements

Render **30 fps, 1,800 frames**. Use only frame, scene data, and fixed seeds: no `Date.now()`, unseeded randomness, timers, mutable simulation, or render-time network calls. Pin Bun, Remotion, Chromium, dependencies, and licensed fonts; test determinism within that environment.

Use 5% margins, captions ≤2 lines/~38 characters per line, ≥48px text, and ≥4.5:1 contrast. Hold key text two seconds; avoid flashing/continuous camera movement. Measure audio against −14 LUFS integrated ±1 and ≤−1 dBTP. Benchmark early; simplify motion, not captions or labels.

## 8. Proposed architecture and tech stack

Use Remotion/React/JavaScript/SVG and headless Chromium within the Bun scaffold. Frames provide timing and still previews. Native codecs are allowed only for encoding/muxing, never visual or audio authoring.

```text
Scene records -> React/SVG -> Remotion frames -> hero MP4
OpenRouter -> approved cache ---------|
JavaScript synth/mixer -> PCM WAV ----|
```

Reject Canvas for extra typography/preview infrastructure, GSAP/Lottie for mutable timing, Three.js for complexity, and footage/generative visuals for violating code-only provenance.

**Cartoon style:** flat fills, rounded geometry, overlapping foreground/background shapes, one offset silhouette, and soft shadows create 2.5D depth. Use Paper `#FFF7E8`, Ink `#20212B`, and restrained Sun `#FFD166`/Mint `#6DD6BC` accents outside interfaces. Pip is one SVG capsule with eyes and a mouth; use static poses and simple group translations, not articulated rigging. Use one bundled font and frame-interpolated entrances; captions stay fixed.

**Authoring:** Claude Opus 5.5’s model ID remains unverified. Request scene-sized JavaScript patches against locked records; review stills/tests. No runtime model dependency.

## 9. Data model / protocol / API surface

`timeline.js` owns BPM, bars, fixtures, and scene objects: `{id, product, startBar, bars, status, claim, prdRef, evidenceRef, captions}`. Captions contain `{fromFrame, toFrame, text}`. Status defaults to `concept`; `prototype` needs supporting evidence. Intro/outro omit product status.

`bun run render:hero` validates records, selects cached/fallback audio, and renders only `hero-16x9.mp4`. `bun run preview:stills` checks specified frames. `bun run music:generate` explicitly requests fresh audio; renders never do so.

**Music contract:** read `OPENROUTER_API_KEY` server-side; never commit/log it. Validate one music model, documented request/response shape, access, and rights. Availability, duration/BPM control, and generation success remain unverified; invent no fields. Limit requests to 120 seconds and one retry. Cache bytes, decoded PCM, prompt/model metadata, and hash. Reject drifting/unusable audio.

Fallback: seeded JavaScript 48kHz stereo PCM/WAV synthesis with percussion, triangle bass, square-wave melody, envelopes, and repeating chords. JavaScript mixes, fades, and meters audio. A few blips illustrate actions, not native product sounds.

## 10. Risks, open questions, and mitigations

Illustrated success may mislead: audit captions against product PRDs, retain labels, and use “Exploring…” wording for concepts. Caret is desktop dictation, not universal voice control; Glassroom does not imply anonymity or endpoint protection. Flopside is multiplayer poker with play-money chips, never real-money gambling.

Unavailable music uses fallback. Renderer drift uses pinned versions and pixel tests. Model access is an authoring prerequisite, not a render dependency.

User decisions: confirm the Opus 5.5 selection; identify products with implementation evidence; provide an OpenRouter key, permitted model, budget, and rights approval if generated music is desired. Until resolved, use concept labels, offline synthesis, and private review.

## 11. Success metrics and a demo script

Use **120 BPM, 4/4**: each beat is 0.5 seconds/15 frames; each bar is two seconds/60 frames. Frames use zero-based bar indices; table bars are one-based inclusive.

| Scene | Seconds | Bars | Illustrated action and caption |
|---|---|---|---|
| Intro | 0–6 | 1–3 | Pip assembles six tiles. “Six ideas. One build session.” |
| Caret | 6–14 | 4–7 | Desktop shortcut → listening → inserted text; no Send. “Caret — Speak. Text at your caret.” |
| Flopside | 14–22 | 8–11 | Two seats, private card backs, wager, shared showdown. “Flopside — Friends. Poker. Free chips.” |
| Patchbay | 22–30 | 12–15 | CLI discovery, result, write-approval pause. “Patchbay — Local agents. Inspectable plugins.” |
| Sidekick | 30–38 | 16–19 | Browser panel plan, action, approval pause. “Sidekick — Browser actions, supervised.” |
| TetherTerm | 38–46 | 20–23 | Same terminal session accepts input and returns output. “TetherTerm — One terminal. Ongoing control.” |
| Glassroom | 46–54 | 24–27 | Paired messages and ciphertext illustration. “Glassroom — Two people. Encrypted text.” |
| Outro | 54–60 | 28–30 | Six independent tiles and credit. “Built by Jia Wei Ng. What next?” |

**Music prompt:** “60-second instrumental, 120 BPM, 4/4, playful cartoon chiptune, clear downbeats, sparse melody, resolve over final three bars; no vocals or artist imitation.” Requested timing is not guaranteed.

**Judge demo, under five minutes:** 0:00–1:00 watch muted; 1:00–2:00 replay with audio, compare one claim to evidence; 2:00–3:00 inspect source/model record and cache/fallback test; 3:00–4:30 compare still hashes, validator, QA, and rebuild command. Pass: six purposes, honest readable labels, authoring provenance, determinism, and complete film.

Tests cover all six names, eight continuous scene intervals, exact duration, caption bounds, required labels, offline fallback, and secret exclusion. Compare decoded pixels from repeated and shuffled-frame renders; review each scene’s hold, cut boundaries, and borderless UI. Watch the complete export and check audio seams/levels. Output H.264/yuv420p, AAC stereo 48kHz, fast-start MP4.

## 12. Milestones and build plan

1. **0–0.5h:** Scaffold, confirm authoring access, lock records, benchmark one scene.
2. **0.5–1.5h:** Shared mascot, layers, UI primitives, captions, validation.
3. **1.5–3.5h:** Six scenes and intro/outro; review wording and stills.
4. **3.5–4h:** Bounded music check, cache or synth, blips, audio lock.
5. **4–6h:** Requirement tests, frame/audio QA, final render, watch-through, source handoff.

**MVP cut line:** one captioned 60-second hero with six honest product scenes, simple 2.5D visuals, required authoring provenance, offline-capable audio, and passing QA. Simplify scene movement before sacrificing any requirement; no additional deliverables follow this cut line.

## 13. Promo-video hooks

- Caret’s thought bubble becomes text beside Pip.
- Flopside’s two seats resolve to one shared showdown.
- Approval pauses and one persistent terminal session lead into Glassroom’s paired-message illustration; all retain readiness labels.

### Appendix A: UI design system (user directive)

Product interiors are clean, minimal, black-and-white, shadcn-style, with **NO borders**. Use black/white and neutral surfaces `#FAFAFA`/`#F4F4F5`, text `#18181B`/`#71717A`, 10px radius, monochrome icons, whitespace, and soft shadows. No outlines or divider strokes. Color belongs only to surrounding scenery. Patchbay stays CLI; TetherTerm stays terminal/MCP transcripts, not invented dashboards.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/07-session-seven.sh` outside this repo to create independent `session-seven/` and its own git repo. Use the same Better-T-Stack command as every project: **one scaffold per project, never a mega scaffold**. This appendix overrides conflicting stack choices. Bun throughout: `bun install`, `bun run`, `bunx`, `bun test`.

Hand-add `apps/video` for JavaScript Remotion compositions and music/render scripts. Use scaffolded `apps/web` only for local preview; no additional film-page deliverable or backend feature. Auth, Mongo, Polar, native, and wxt remain dormant.
