# Session Seven — Promotional Video PRD

**Builder:** Jia Wei Ng · **Environment:** Manus Studio · **MVP:** 6–8 focused hours · **Research checked:** November 21, 2026.

## 1. Overview

**Session Seven** is an 80-second code-driven cartoon showcase of Caret, Switch Snatch, Patchbay, Sidekick, TetherTerm, Glassroom, and Almost. A mascot travels from expressing an idea, through supervised tools and human connection, to restarting unfinished work. The products remain independent; never imply integration or seven completed releases. Ship 1920×1080 landscape and 1080×1920 portrait MP4s from one React composition using layout props. Every shape, character, UI mock-up, caption, transition, and camera move is authored in JavaScript/TypeScript/React/SVG, version-controlled, and re-renderable with one command. Default storytelling uses kinetic captions, not voiceover.

## 2. Problem statement and the original brief

Seven disconnected demos are difficult to remember. Explain their real purposes without letting animation masquerade as implementation evidence. The new brief replaces captured footage and editor-based assembly with authored animation; generated music is the permitted external media exception.

- [ ] **R1:** Cover all seven products in one coherent 80-second hero.
- [ ] **R2:** Produce visuals purely through JavaScript; no recordings, editors, hand-drawn assets, or external image/video generation.
- [ ] **R3:** Select one rendering approach after research and reject alternatives.
- [ ] **R4:** Author with Claude Opus 5.5 inside Manus Studio; confirm its exact model ID.
- [ ] **R5:** Specify cartoon 2.5D art, rigging, layers, palette, and typography.
- [ ] **R6:** Illustrate faithful black-and-white, borderless product interfaces.
- [ ] **R7:** Specify OpenRouter music, verified API boundaries, caching, and JS-only fallback.
- [ ] **R8:** Derive timing from beats; deliver both aspect ratios.
- [ ] **R9:** Label prototypes/concepts, avoid fabricated metrics, and define QA, milestones, and optional 15–20-second cuts.

## 3. Goals and non-goals

Make each product’s name and purpose intelligible on a phone muted. Give each one a recognizable input-to-outcome illustration, preserve its limitations, and deliver repeatable source plus two exports. Demonstrate reproducible animation, not operational product proof.

Non-goals include building products, an editor, photorealism, runtime AI animation, autonomous publishing, and invented performance/security claims. No simulated screen is a live demo. Narration and generative visuals are excluded from MVP. Product cuts reuse components.

## 4. Target users and key user stories

**Judge:** “Explain seven ideas without installations.” Acceptance: all names appear, purposes are distinct, and unfinished work has persistent “Prototype” or “Concept” labels.

**Social viewer:** “I can follow portrait muted.” Acceptance: captions, statuses, and essential illustrated actions remain readable without pausing.

**Builder:** “Change one scene safely.” Acceptance: a local patch updates both layouts through `bun run render:all`, without model access or audio regeneration.

**Collaborator:** “Distinguish illustration from capability.” Acceptance: every product scene says “Illustrated UI”; claims reference a PRD and implementation evidence when available. PRDs describe intent, not readiness.

## 5. Core user flows

1. **Prepare:** Create `/home/ubuntu/promo-video/`; lock storyboard, names, tokens, BPM, sanitized fixtures, and claims. Default products to concept pending review.
2. **Author:** Ask Claude Opus 5.5 in Studio for one scene using shared contracts and approved wording. Generate code only.
3. **Preview:** Render entrance, reading-hold, action-result, and exit stills in both layouts. Review mechanics, rig consistency, and labels.
4. **Score:** With a key, generate/audition OpenRouter music. Without access or an acceptable result, synthesize locally.
5. **Render:** Freeze approved audio, captions, statuses, and hashes. One command validates, prepares cached/fallback audio, and renders both compositions.
6. **Deliver:** Inspect beat stills, watch exports, repair affected components, and package source. Publishing requires separate approval.

Missing evidence changes wording/status, never apparent proof. Late changes update fixtures and captions together. Failed music requests cannot block rendering.

## 6. Functional requirements

**P0:** **F01** Validate seven scene records, frame ranges, claims, and readiness. **F02** Implement the timing table as deterministic React/SVG scenes. **F03** Share mascot, palette, typography, devices, and motion helpers. **F04** Render both layouts explicitly, not by cropping. **F05** Burn captions/statuses into scenes; export SRT from the same records. **F06** Provide `generate-music.ts`, audio caching, pure-code music/SFX synthesis, and JS mixing. **F07** Produce stills, determinism checks, loudness measurements, and export metadata. **F08** Deliver source, lockfile, storyboard, manifest, licenses, stems, README, and MP4s.

**P1:** **F09** Reuse `ProductCut` for one 16-second cut, optionally all seven at 15–20 seconds. **F10** Export a code-rendered thumbnail and caption-free master.

**P2:** **F11** Optional OpenRouter TTS, translations, and richer choreography; never delay the caption-only hero.

## 7. Non-functional requirements

Use **30 fps**, exactly **2,400 frames**. Animation is a pure function of frame, props, and fixed seed; forbid `Date.now()`, unseeded randomness, timer-driven CSS animation, render-time network calls, and mutable simulation. Pin Node, Remotion, Chromium, dependencies, and bundled licensed fonts. Determinism applies within the pinned environment, not arbitrary GPUs/browsers.

Benchmark eight seconds first. Target half-resolution preview within five minutes and both finals within thirty: estimates, not guarantees. Start concurrency two, emit progress, and simplify shadows if slow.

Captions: maximum two lines, approximately 38 characters/line, minimum 48px output text, ≥4.5:1 contrast. Landscape has 5% margins; portrait reserves top 10%, bottom 20%, and right 12% for platform overlays. Statuses stay inside safe zones. Avoid flashing and continuous camera motion. Target **−14 LUFS integrated ±1**, ≤−1 dBTP; measure rather than assume normalization succeeded.

## 8. Proposed architecture and tech stack

Choose **Remotion, React, TypeScript, SVG, Node, and headless Chromium**. Official documentation confirms H.264 composition rendering with props and isolated-frame stills [1] [2]. Components support shared rigs and dual layouts. Chromium rasterizes authored scenes, not product screens. Native codec binaries, including FFmpeg where Remotion uses it, are permitted only for final encoding/mux; no footage editing, filter graphics, or audio authoring depends on them.

```text
PRDs/evidence -> claims/timeline.ts -> React/SVG scene library
OpenRouter adapter -> cached audio -----------|
Pure TS synth/mixer -> PCM WAV ---------------|
                                             v
              Remotion frames -> final encode/mux -> two MP4s
                                             +----> stills/QA/source
```

Reject custom Canvas/Node rendering because typography, composition, and previews require extra infrastructure. Reject GSAP/Lottie playback as timing authority because mutable playback complicates random-frame evaluation. Reject Three.js for unnecessary complexity, generative visuals for violating provenance, and recording/editors for violating the brief.

### Cartoon 2.5D design system

Use flat vector fills and rounded geometry, without gradients suggesting realistic lighting. Depth comes from overlapping layers, stacked offset silhouettes, perspective tilt, and soft shadows—not textures.

| Token | Hex | Use |
|---|---|---|
| Ink | `#20212B` | World text, eyes, shadows |
| Paper | `#FFF7E8` | Background, neutral props |
| Sun | `#FFD166` | Mascot, idea cues |
| Mint | `#6DD6BC` | Connection motifs |
| Coral | `#F58282` | Playful props |
| Lilac | `#AFA0EE` | Museum, secondary scenery |

Each scene uses Paper/Ink plus two accents. Background/midground/foreground z offsets: −40/0/+40px; parallax multipliers: 0.25/0.6/1.0. Camera travel ≤24px/bar. Device tilt ≤6° with 1,200px perspective; return front-on for reading. Extrusion uses three stacked shapes at 2px offsets. Shadows: Ink, 12% opacity, 8px blur, 6px vertical offset. Captions never parallax.

**Character:** “Pip,” a 120×160 SVG capsule: Sun body, Ink oval eyes, simple mouth, two arm pivots, two foot pivots. Expose pose, gaze, blink, squash, and hand-target props through one shared rig. Animate SVG groups and transform origins. Squash spans 0.90–1.10 with reciprocal scaling; overshoot ≤8%, then settle.

**Motion:** entrances 12–18 frames, `cubic-bezier(0.22,1,0.36,1)`; exits 8–12 frames, `cubic-bezier(0.4,0,1,1)`; emphasis 6–10 frames. Evaluate curves through frame interpolation. One emphasis per beat; captions hold stably for two seconds. Kinetic type reveals words, not endless letter animation.

**Product interiors:** black `#000000`, white `#FFFFFF`, surfaces `#FAFAFA`/`#F4F4F5`, text `#18181B`/`#71717A`. Clean minimal shadcn-style spacing, 10px radius, monochrome fills/icons. No borders, outlines, divider strokes, or colored accents; separate by whitespace, tone, and soft shadow. Patchbay remains CLI; headless TetherTerm appears as terminal/MCP transcripts, not invented dashboards. Surrounding cartoon scenery carries color.

### AI-assisted authoring workflow

Use the user’s stated **Claude Opus 5.5** inside Manus Studio; exact selectable/API model ID is **to be confirmed by the user**. Invent no integration details or silent substitutions. Prompt scene-by-scene with behavior, frame interval, captions, layout rules, tokens, and rig imports; request scoped component patches and tests. Review per-scene stills, provide frame-specific corrections, rerender, and checkpoint accepted code. Version prompts and decisions. Never independently regenerate the whole film; finished previews/exports have no runtime code-generation-model dependency.

## 9. Data model / protocol / API surface

```ts
type SceneSpec = {
  id: string; product?: string; startBar: number; bars: number;
  status: 'verified' | 'prototype' | 'concept';
  claim: string; prdRef: string; evidenceRef?: string;
  captions: {fromFrame: number; toFrame: number; text: string}[];
};
type Layout = 'landscape' | 'portrait';
// Scene -> Stage -> Layer -> Character / DeviceFrame / ProductMockup
// Caption and StatusBadge remain fixed safe-zone siblings.
```

`Scene` schedules local frames; `Stage` provides layout geometry; `Layer` handles depth; `Character` handles rigging; `DeviceFrame` fits borderless UI; `Caption` handles timing. `timeline.ts` owns BPM, bars, captions, and fixtures. `bun run render:all` validates, prepares offline audio, renders both formats, exports SRT, and runs QA. `bun run preview:stills` evaluates selected frames. `bun run music:generate -- --refresh` explicitly requests new audio; renders never regenerate music.

### OpenRouter music and audio contract

**Verified publicly:** OpenRouter lists `google/lyria-3-pro-preview` for full songs and `google/lyria-3-clip-preview` for 30-second clips [3]. Pro metadata advertises text+audio output [4]. General audio uses bearer-authenticated `POST /api/v1/chat/completions`, `model`, `messages`, `modalities:["text","audio"]`, and streaming SSE. Its speech-oriented example uses `audio:{voice:"alloy",format:"pcm16"}` and base64 fragments in `choices[].delta.audio.data` [5]. Separate TTS uses `POST /api/v1/audio/speech`, `model,input,voice,response_format`, returning binary audio [6].

**Unverified:** no sandbox key; account access, generation success, music-specific transport, exact duration/BPM/key control, and release rights are untested. Never assume Lyria accepts speech voices or a `duration` field. Generic model documentation does not establish a tested music response.

`generate-music.ts` reads `OPENROUTER_API_KEY`, configurable `OPENROUTER_MUSIC_MODEL`, and versioned prompt templates. Tentatively select Pro following an authenticated smoke test. Define `MusicProvider.generate({prompt,targetSeconds,bpm,key})`; these are internal inputs, not invented API fields. Discover public audio models/account availability through documented model APIs [7]. Enable the provider after validating its contract. Bound requests to 120 seconds and one retry; never log keys.

Cache bytes, decoded PCM, prompt/model metadata, duration, rights review, and SHA-256 in project `/assets/audio` (`/home/ubuntu/promo-video/assets/audio`). JavaScript decodes, trims, and mixes. Align accepted loops to whole bars with short sample-domain seam crossfades and ending fade. If tempo drifts or an acceptable 80-second arrangement is unavailable, use fallback rather than claim exact beat-sync.

Fallback: pure-TypeScript 48kHz stereo PCM/WAV synthesis with seeded noise percussion, triangle bass, square-wave melody, envelopes, and a written eight-bar chord pattern. JS mixing/loudness metering prepares the stem before encoding. Synthesized clicks/pops/chimes mark illustrated actions, not alleged native sounds. No voiceover by default; stretch OpenRouter TTS requires approval and cached output.

## 10. Risks, open questions, and mitigations

Illustrated success can mislead: retain “Illustrated UI,” audit claims, and persist readiness badges. Glassroom never implies anonymity, auditing, or endpoint protection. Caret is Windows-first dictation, not universal voice control. Almost progress is not completion.

Scene drift requires locked tokens/rigs. Crowded portrait requires stacked interfaces or alternating close-ups, not tiny text. Renderer differences require pinned versions. Unavailable/off-tempo/unlicensed provider music requires approved caches and the synth route.

Questions: Which Opus 5.5 selection exists in Studio? Which builds have evidence? Can Jia supply an OpenRouter key, allowed model, budget, and rights approval? Defaults: concept labels, offline synthesis, caption-only film, private review. Authoring-model availability never affects already-authored renders.

## 11. Success metrics and a demo script

Use **120 BPM, 4/4, C major**, playful optimistic chiptune/lo-fi. Beat: 0.5 seconds/15 frames; bar: two seconds/60 frames. Cuts derive from `frame = barIndex * 60`, internally zero-based. Table bars are one-based inclusive.

| Scene | Seconds | BPM bars | On-screen action | Caption text |
|---|---|---|---|---|
| Opening | 0–8 | 1–4 | Pip assembles seven coded tiles. | “Seven ideas. One build session.” |
| Caret | 8–16 | 5–8 | Shortcut, Listening, polished Windows draft text; no Send. | “Caret — Speak. Text at your caret.” |
| Sidekick | 16–24 | 9–12 | Panel plan, page scroll, reference tab, approval pause. | “Sidekick — Browser actions, supervised.” |
| Patchbay | 24–32 | 13–16 | Scout/Ledger discovery; TODO result precedes write approval. | “Patchbay — Local agents. Inspectable plugins.” |
| TetherTerm | 32–40 | 17–20 | Same Python session receives input, returns 42, remains running. | “TetherTerm — One terminal. Ongoing control.” |
| Glassroom | 40–48 | 21–24 | Fingerprints, paired messages, ciphertext/metadata illustration. | “Glassroom — Two people. Encrypted text.” |
| Switch Snatch | 48–56 | 25–28 | Shared vault: flip exits, steal jewel, bank; compressed example. | “Switch Snatch — Flip. Steal. Bank.” |
| Almost | 56–64 | 29–32 | Museum exhibit, five-minute restart card, progress: Moved again. | “Almost — Unfinished is not failed.” |
| Constellation | 64–72 | 33–36 | Seven tiles gather with individual readiness labels. | “Different tools. Room for possibility.” |
| Closing | 72–80 | 37–40 | Pip waves; credit and CTA hold. | “Built by Jia Wei Ng. What next?” |

Concept slots retain “Concept” and replace capability wording with “Exploring…” when implementation is absent.

**Music prompt:** “80-second instrumental, 120 BPM, 4/4, C major. Playful optimistic cartoon chiptune, warm lo-fi drums, triangle bass, sparse square-wave melody. Clear downbeats; lift every four bars; gentler museum passage, bars 29–32; resolve, bars 37–40. No vocals, artist imitation, or speech. Clean loopable phrases.” Timing is requested, not guaranteed.

**Judge demo, under five minutes:** watch landscape, then portrait muted; compare one claim with its PRD/evidence; rerender one beat still twice; inspect QA/rebuild command. Pass requires seven purposes, honest labels, and both exports—not fabricated product metrics.

QA compares decoded-pixel hashes of beat stills rendered twice and in shuffled order. Review each bar downbeat, reading hold, and cut-adjacent frame in both layouts. Check rig continuity, borderless UI, safe zones, spelling, status persistence, and audio seams. Measure loudness/true peak; watch complete exports. Deliver exactly 80 seconds, H.264/yuv420p, AAC stereo 48kHz, fast-start MP4; target ≤100MB each, reducing bitrate before readability. Include `hero-16x9.mp4`, `hero-9x16.mp4`, `hero.srt`, stems, QA JSON, and source.

## 12. Milestones and build plan

1. **Hour 0–1:** Initialize Remotion/TS, fonts, validator, claims, and both compositions; benchmark one scene.
2. **Hour 1–2:** Build tokens, Pip, layers, UI primitives, captions, and safe-zone tests; approve stills.
3. **Hour 2–4:** Author seven scenes sequentially with Opus 5.5; review both layouts and checkpoint each.
4. **Hour 4–5:** Add intro/outro, synth/SFX, provider adapter, and cache without credential dependency.
5. **Hour 5–6:** Preview; fix claims, caption holds, cuts, and portrait; lock audio.
6. **Hour 6–8:** Test determinism/loudness, render finals, watch, and package one-command rebuild.

**MVP cut line:** seven honestly labeled scenes, shared cartoon library, two captioned 80-second exports, deterministic fallback audio, and passed QA/source handoff. Cut narration, elaborate transitions, thumbnails, and product cuts first—not honesty, readability, or reproducibility.

## 13. Promo-video hooks

Pip’s thought bubble becomes Caret text without sending. Sidekick’s approval pause match-cuts into Patchbay write approval. TetherTerm retains one session identity as an answer lands on-beat. Glassroom fingerprints become connection motifs around Switch Snatch’s jewel chase. Almost turns the unfinished tile into a museum exhibit: “Moved again,” not “Finished.” All are code-authored illustrations with readiness labels.

**References**

[1]: https://www.remotion.dev/docs/renderer/render-media "Remotion programmatic media rendering"
[2]: https://www.remotion.dev/docs/renderer/render-still "Remotion isolated-frame still rendering"
[3]: https://openrouter.ai/collections/audio-models "OpenRouter audio and music model collection"
[4]: https://openrouter.ai/api/v1/model/google/lyria-3-pro-preview "OpenRouter public Lyria Pro metadata"
[5]: https://openrouter.ai/docs/guides/overview/multimodal/audio "OpenRouter audio streaming output guide"
[6]: https://openrouter.ai/docs/guides/overview/multimodal/tts "OpenRouter dedicated text-to-speech API"
[7]: https://openrouter.ai/docs/api_reference/models "OpenRouter model and account discovery"

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/08-session-seven.sh` from a workspace folder outside this repo. It creates `session-seven/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

The film is pure JavaScript (Remotion), which Better-T-Stack does not generate. Use the same scaffold for consistency and hand-add `apps/video` (Remotion compositions and render scripts). `apps/web` (Next.js) hosts the Remotion Player preview and the final film page; Hono can serve rendered assets; the music-generation script lives in `apps/video/scripts`. Auth, Mongo, Polar, native and wxt stay dormant.
