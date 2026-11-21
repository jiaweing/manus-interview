# #155 — Shared primitives review

**Author/reviewer:** Manus swarm agent b155/builder. Authored by Manus swarm agent b155/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY). No model request, generation id, or accepted Opus patch exists. This is a builder self-check, not independent verification or full-film approval.

## Decision

**PASS for the shared foundation and replaceable scene stubs.** Opened all four final native 1920×1080 gallery PNGs, then inspected unscaled 1:1 crops of the interface and capsule detail. The crops were temporary inspection aids in `/tmp`, not authored assets or deliverables. All source graphics are JavaScript/JSX/SVG, using bundled fonts only.

| Reviewed PNG (relative to product root) | Observations |
| --- | --- |
| `qa/stills/primitives/frame-0000.png` | Six static poses: neutral, happy, listening, thinking, pointing, waving. Exactly one primary rounded capsule body per Pip, two eyes and a mouth; the darker displaced capsule is its single silhouette copy, not a second mascot. Facial drawings and tiny detached accent positions change discretely; no rig or articulated arms. Soft shadows and overlapping Mint/Sun scenery establish restrained 2.5D depth. |
| `qa/stills/primitives/frame-0060.png` | Window, panel, row, buttons, block caret and dark CLI. Interface interiors are neutral fills; there are no visible borders, outlines or separating lines. Whitespace and #F4F4F5 panels do the separation. Secondary gray sits only on #FAFAFA, while all key text is #18181B (or #FAFAFA on dark). Two-line caption is unclipped inside the fixed white plate. |
| `qa/stills/primitives/frame-0120.png` | Mic, keyboard, lock, card-back, chip, globe, browser, terminal prompt, check, hourglass and pause are filled SVG path glyphs, including even-odd cutouts; no stroked paths. All labels readable and separated. |
| `qa/stills/primitives/frame-0180.png` | Foreground Mint overlaps the flat Sun shape and offset Ink copy; Pip overlaps both. Soft shadow falls below/right without turning interfaces into colored surfaces. Prototype is visibly distinct from Concept. Gallery-only Prototype example does not change any production scene status. |

### Stub-film smoke inspection

Ran `bun run preview:stills --frames 0,210,630,870,1110,1350,1590,1799` and rendered all eight requested PNGs successfully. Retained and visually opened these three representative files:

- `qa/stills/frame-0000.png`: intro has only its fixed caption, **no** Illustrated UI/readiness label.
- `qa/stills/frame-0210.png`: Caret has the exact locked two-line caption, including product name, plus the fixed top-left Illustrated UI / Concept stack.
- `qa/stills/frame-1799.png`: final frame has the exact Jia Wei Ng credit caption, **no** product label.

Also rendered `bun run preview:stills --scene caret --frames 210`; `qa/stills/caret/frame-0210.png` is the retained scoped-output example. Frame 420 is correctly rejected as outside Caret's end-exclusive `[180,420)` interval. The five other global smoke stills were deleted after a successful render; no unreviewed extra stills are committed. The placeholders intentionally do not claim any product behavior and will be replaced by the scene issues.

## Typography, contrast, timing and geometry

The bundled Inter weights 400, 600 and 700 load through local `@font-face` / `staticFile`, with a delayRender handle released only after all three weights resolve. Caption text is 60px / 700, line height 72px; labels are 48px / 600; UI reading text defaults to 48px (TextLine clamps smaller requests to 48). There is no bundled mono, so CLI uses Inter deliberately.

Safe bounds are **x 96..1824, y 54..1026**. Illustration bounds are **x 96..1824, y 224..790**. Caption plate is **x=96, y=826, w=1728, h=200**, with 36px horizontal padding and at most two centered lines. Labels use **(96,54,432,64)** and **(96,128,300,64)**. Geometry tests check the actual exported rectangles and text boxes, safe bounds and non-collision.

`contrastRatio` computes WCAG relative luminance. #71717A on #FAFAFA is **4.6302515748:1**, above 4.5; on #F4F4F5 it is **4.3968779846:1**, and on #18181B only **3.6658696332:1**, so those latter reading pairs are unsupported. Every supported reading pair in theme.TEXT_PAIRS passes ≥4.5. All key interface text uses #18181B on light fills or #FAFAFA on #18181B; captions use Ink on white.

Each product label stack stays unchanged across its entire 240-frame scene. Captions use their absolute from/to values minus sceneStartFrame, end-exclusive; their locked holds are 180 or 240 frames (well over 60). Intro/outro render no product-status stack. Stubs have one tiny bounded translation entrance, then a static hold; no continuous camera motion. Pure-helper tests cover repeated and shuffled frame values, PRNG regeneration, and source exclusion of wall clocks, unseeded randomness, timers, remote assets and render-time network functions.

## Commands and evidence

- `bun test apps/video/tests/primitives.test.js`: **19 pass, 0 fail, 4100 assertions**, 8.07s. Real three-frame smoke: 7.662s, guarded by Bun's 90s test deadline and an 85s subprocess timeout; temporary outputs cleaned. `qa/primitives-tests.txt`.
- `bun run preview:stills --group primitives`: **STILLS ok count=4**. Bundle 4.207s, renders 3.517s, total 8.730s, sequential concurrency 1. `qa/primitives-gallery-verification.txt`.
- Eight-scene command above: **STILLS ok count=8**. Bundle 22.044s, renders 5.715s, total 28.886s (measured while other swarm tasks were active), concurrency 1. `qa/primitives-hero-smoke.txt`.
- Scoped Caret command: **STILLS ok count=1**; total 5.634s. Invalid scoped frame returned exit 1 before bundling. `qa/primitives-scoped-stills.txt`.
- In `apps/video`, `bunx remotion compositions src/index.js`: only **Hero / 30fps / 1920×1080 / 1800 frames / 60.00 sec**. `qa/primitives-hero-registry.txt`. The CLI emitted the existing scaffold warning about missing root @session-seven/config/tsconfig.base.json after video-only install; bundling and registry exit 0.
- Post-rebase full suite: **117 pass, 0 fail, 67149 assertions**, 20.32s; `qa/primitives-full-suite.txt`.

The initial unit run caught an incorrect PRNG test golden value, not nondeterminism in the implementation. Corrected that expectation to the independently evaluated Mulberry32 output; reran the exact command and kept the passing evidence above. The initial failed log is retained as `/tmp/b155-primitives-first-tests.txt`, not misrepresented as a passing run.

## Exported API for the scene builders

Replace your assigned file under `src/scenes/` wholesale; preserve its named component export and matching sceneId. Never import another scene file. `scenes/index.js` already maps all eight ids (`intro`, `caret`, `flopside`, `patchbay`, `sidekick`, `tetherterm`, `glassroom`, `outro`). Hero already supplies Sequence intervals, so `useCurrentFrame()` inside each component is **local**, starting at 0.

- **`SceneFrame.jsx`**: `SceneFrame({sceneId, children})` owns local FontLoader, seeded Backdrop and SVG root, exact timeline caption, persistent honest label stack. Its children are **SVG nodes in global 1920×1080 coordinates**; do not add an outer SVG or duplicate caption/labels. `SCENE_LAYOUT` exports safe, illustration, caption, padding/line height and label rectangles. `getScenePresentation(sceneId, localFrame)` and `captionGeometry(text)` are pure layout/data helpers. `CaptionPlate` and `LabelStack` are review-level exports; product scenes should use SceneFrame, not hand-render overlays.
- **`theme.js`**: `PALETTE` (Paper/Ink/Sun/Mint), `UI` (card/panel/ink/muted/white), `FONT_FAMILY`, `FONT_SIZES`, `RADIUS`, `SAFE`, `TEXT_PAIRS`, `contrastRatio(hex1, hex2)`. Sun/Mint are **exterior scenery/Pip only**. Use secondary gray only on UI.card. Never scale UI containers below their native text sizing.
- **`anim.js`**: `beat(n)`=15n frames; `bar(n)`=60n, both zero-based offsets/durations. `enter(frame,start=0,duration=30)` is clamped smoothstep 0..1. `translateIn(frame,start,duration,{fromX=0,fromY=48,toX=0,toY=0})` returns `{x,y}` for `<Group {...translation}>`; it settles permanently. `hold(frame,start,duration)` is an end-exclusive boolean. `seeded(seed)` is Mulberry32; instantiate from a fixed seed afresh when deriving a frame, never retain the generator across frames. `clamp01` is also exported.
- **`Pip.jsx`**: `Pip({x=0,y=0,scale=1,pose='neutral'})`; x/y is top-left. Native body is 200×300, radius 100 (`PIP_BODY`); silhouette extends 18px right / 20px down plus shadow. Poses in `PIP_POSES`: neutral, happy, listening, thinking, pointing, waving. All are static drawings; move the whole group with a bounded frame-derived x/y if needed.
- **`layers.jsx`**: `Group({x=0,y=0,scale=1,children})` translates/scales local child coordinates. `SoftShadow({children,dx=0,dy=14,blur=12,opacity=.16,color=Ink})` uses unique useId-based filters. `OffsetSilhouette({x=18,y=20,opacity=.14,children})` uses inherited Ink fill: pass the same **unfilled body geometry**, then draw your filled foreground. Scenery only. `Backdrop({seed})` and pure `backdropShapes(seed)` supply fixed exterior shapes. SceneFrame already supplies Backdrop.
- **`ui.jsx`**: SVG local-coordinate containers. `Window({x,y,width=1100,height=500,children})` is a #FAFAFA surface with neutral soft shadow; `Panel({x,y,width=900,height=260,children})` / `Row({x,y,width=900,height=86,children})` use #F4F4F5 fills. Children are **local to the container**. No custom surface color/style escape hatch. `Cli({x,y,width=1100,height=500,light=false,lines=[],children})` uses dark #18181B or light #FAFAFA; lines start at (40,78), spaced 68px. Wrap long transcripts manually in scene data at the native 48px reading size. `TextLine({x,y,text,children,fontSize=48,fontWeight=400,tone='primary',dark=false,textAnchor='start'})` uses **SVG baseline y**. `Button({x,y,width=330,height=80,label,children,variant='primary'})` has centered 48px/600 text; secondary variant is a light fill. `Caret` / alias `Cursor` are fixed blocks with `{x,y,width=8,height=52,dark=false}`. `Icon({name,x,y,size=48,dark=false})` uses filled 24×24 paths scaled to size; names are `mic`, `keyboard`, `lock`, `card-back`, `chip`, `globe`, `browser`, `terminal-prompt`, `check`, `hourglass`, `pause` (`ICON_NAMES`).
- **Still CLI**: `bun run preview:stills --scene caret --frames 180,210,419` uses **absolute Hero frames**, validates each lies in that scene, and writes `qa/stills/caret/frame-0180.png` etc. Without --scene, write directly under `qa/stills/`. `--out <dir>` changes that base; scene/group directory rules still apply. `--group primitives` uses the separate gallery entry, default frames 0/60/120/180. Lists reject invalid, duplicate, noninteger or >1799 frames; gallery additionally rejects >239. One bundle and one reused pinned Chromium per invocation, sequential renders, PNG validation, fail-fast errors, final `STILLS ok count=<n>`.

### Example drawing contract

```jsx
export const CaretScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="caret">
    <Pip x={300} y={350} scale={1.15} pose="listening" />
    <Group {...translateIn(frame, beat(2), beat(2), { fromY: 18 })}>
      <Window x={660} y={278} width={1040} height={452}>
        <TextLine x={48} y={94} text="Sample draft" fontWeight={600} />
        <Panel x={48} y={142} width={944} height={248}>
          <TextLine x={40} y={90} text="Reading text stays at 48px." />
        </Panel>
      </Window>
    </Group>
  </SceneFrame>;
};
```

**Unverified / out of scope:** independent clean-worktree acceptance, normal-speed full-film playback, final scene behavior, audio (#167), final MP4 and whole-film pixel determinism. No API/model/network calls are made by render code or the still command. No claim that this foundation resolves the blocked Opus authoring prerequisite.
