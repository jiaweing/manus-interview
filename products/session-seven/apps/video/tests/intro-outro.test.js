import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { IntroScene, INTRO_TILES, INTRO_TIMING, introTileState, introPipState } from "../src/scenes/IntroScene.jsx";
import { OutroScene, OUTRO_TILES, OUTRO_TIMING, outroTileState, outroPipState } from "../src/scenes/OutroScene.jsx";
import { SCENE_LAYOUT, getScenePresentation } from "../src/SceneFrame.jsx";
import { PALETTE, contrastRatio } from "../src/theme.js";
import { FRAMES_PER_BEAT, SCENES, sceneStartFrame, sceneEndFrame } from "../src/timeline.js";
import { stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const NAMES = ["Caret", "Flopside", "Patchbay", "Sidekick", "TetherTerm", "Glassroom"];
const cases = [
  { id: "intro", component: IntroScene, tiles: INTRO_TILES, timing: INTRO_TIMING,
    tileState: introTileState, pipState: introPipState, caption: "Six ideas. One build session.", range: [0, 180] },
  { id: "outro", component: OutroScene, tiles: OUTRO_TILES, timing: OUTRO_TIMING,
    tileState: outroTileState, pipState: outroPipState, caption: "Built by Jia Wei Ng. What next?", range: [1620, 1800] },
];
const codeFor = (component) => readFile(join(videoDir, "src/scenes", `${component.name}.jsx`), "utf8");

describe("#156 intro and independent credited outro", () => {
  test("named components retain exact 180-frame timeline intervals", async () => {
    for (const item of cases) {
      expect(typeof item.component).toBe("function");
      expect(await codeFor(item.component)).toContain(`<SceneFrame sceneId="${item.id}">`);
      const scene = SCENES.find(({ id }) => id === item.id);
      expect([sceneStartFrame(scene), sceneEndFrame(scene)]).toEqual(item.range);
      expect(item.timing.end).toBe(180);
      expect(scene.status).toBeUndefined();
    }
  });
  test("exactly six correctly spelled names, no duplicates, same scenery-card style", () => {
    expect(INTRO_TILES.map(({ name }) => name)).toEqual(NAMES);
    expect(OUTRO_TILES).toEqual(INTRO_TILES);
    for (const item of cases) {
      expect(Object.isFrozen(item.tiles)).toBe(true);
      expect(item.tiles).toHaveLength(6);
      for (const tile of item.tiles) {
        expect(Object.isFrozen(tile)).toBe(true);
        expect(tile.width).toBe(496);
        expect(tile.height).toBe(250);
        expect(tile.fontSize).toBeGreaterThanOrEqual(48);
        expect(Object.values(PALETTE)).toContain(tile.fill);
        expect(Object.values(PALETTE)).toContain(tile.text);
        expect(contrastRatio(tile.text, tile.fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test("all 360 frames have fixed exact captions, no readiness or Illustrated UI labels", () => {
    for (const item of cases) {
      const first = getScenePresentation(item.id, 0);
      for (let frame = 0; frame < item.timing.end; frame++) {
        const presentation = getScenePresentation(item.id, frame);
        expect(presentation.caption.text).toBe(item.caption);
        expect(presentation.geometry).toEqual(first.geometry);
        expect(presentation.labels).toEqual([]);
        expect(presentation.geometry.fontSize).toBeGreaterThanOrEqual(48);
        expect(presentation.geometry.lines.every((line) => line.length <= 38)).toBe(true);
      }
      expect(getScenePresentation(item.id, 179).caption.text).toBe(item.caption);
      expect(getScenePresentation(item.id, 180).caption).toBeUndefined();
      expect(first.caption.toFrame - first.caption.fromFrame).toBe(180);
    }
  });
  test("each entrance starts on a beat, no action blips, settled holds exceed 60 frames", () => {
    expect(INTRO_TIMING.tileStarts).toEqual([0, 15, 30, 45, 60, 75]);
    expect(OUTRO_TIMING.tileStarts).toEqual([0, 0, 15, 15, 30, 30]);
    for (const item of cases) {
      expect(item.timing.actionBlip).toBeNull();
      for (const value of [...item.timing.tileStarts, item.timing.tileDuration, item.timing.pipStart, item.timing.pipDuration]) {
        expect(value % FRAMES_PER_BEAT).toBe(0);
      }
      expect(item.timing.end - item.timing.settled).toBeGreaterThanOrEqual(60);
      for (let frame = item.timing.settled; frame < item.timing.end; frame++) {
        item.tiles.forEach((tile, index) => {
          expect(item.tileState(frame, index)).toEqual({ x: tile.x, y: tile.y });
        });
        expect(item.pipState(frame)).toEqual(item.pipState(item.timing.settled));
      }
    }
  });
  test("all cards stay in the illustration area and visibly separated at every frame", () => {
    const area = SCENE_LAYOUT.illustration;
    for (const item of cases) for (let frame = 0; frame < item.timing.end; frame++) {
      const rectangles = item.tiles.map((tile, index) => ({ ...tile, ...item.tileState(frame, index) }));
      for (const tile of rectangles) {
        expect(tile.x).toBeGreaterThanOrEqual(area.x);
        expect(tile.y).toBeGreaterThanOrEqual(area.y);
        expect(tile.x + tile.width).toBeLessThanOrEqual(area.right);
        expect(tile.y + tile.height).toBeLessThanOrEqual(area.bottom);
      }
      for (let a = 0; a < rectangles.length; a++) for (let b = a + 1; b < rectangles.length; b++) {
        const left = rectangles[a], right = rectangles[b];
        const horizontal = Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width);
        const vertical = Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height);
        expect(Math.max(horizontal, vertical)).toBeGreaterThanOrEqual(6);
      }
      const pip = item.pipState(frame);
      expect(pip.x).toBeGreaterThanOrEqual(area.x);
      expect(pip.y).toBeGreaterThanOrEqual(area.y);
      expect(pip.y + 320 * pip.scale).toBeLessThanOrEqual(area.bottom);
      expect(pip.x + 218 * pip.scale).toBeLessThan(Math.min(...rectangles.map(({ x }) => x)));
    }
  });
  test("frame helpers are deterministic when called repeatedly or out of order", () => {
    for (const item of cases) for (const frame of [179, 0, 150, 30, 0, 179]) {
      for (let index = 0; index < 6; index++) expect(item.tileState(frame, index)).toEqual(item.tileState(frame, index));
      expect(item.pipState(frame)).toEqual(item.pipState(frame));
    }
  });
  test("both scenes use shared Pip and primitives, with no interface/status/connection or runtime patterns", async () => {
    const forbidden = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b|https?:\/\/|useState|useEffect|<image\b|<svg\b/;
    const misleading = /\b(?:Concept|Prototype|Illustrated UI|Send|sent|currency|deposit|withdrawal|payment|suite|integrated|hub)\b|[$€£¥]|<line\b|<polyline\b|markerEnd|stroke|border|outline|from\s+["'][^"']*\/ui\.jsx/;
    for (const item of cases) {
      const code = await codeFor(item.component);
      expect(code).not.toMatch(forbidden);
      expect(code).not.toMatch(misleading);
      expect(code).not.toMatch(/from\s+["']\.\/.*Scene/);
      expect(code).toContain('from "../Pip.jsx"');
      expect(code).toContain("<Pip");
      expect(code).toContain("<SoftShadow");
      expect(code).toContain("<OffsetSilhouette");
      expect(code).toContain("data-scenery-tile={tile.name}");
      expect(code).not.toMatch(/opacity=\{(?:frame|enter)/);
      for (const name of NAMES) expect(code).toContain(`name: "${name}"`);
    }
  });
  test("real pinned-Chromium smoke: opening, assembled intro and credited last frame within 90s", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-intro-outro-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--frames", "0,150,1799", "--out", out],
    { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      expect((await readdir(out)).sort()).toEqual([0, 150, 1799].map(stillFilename).sort());
      for (const frame of [0, 150, 1799]) {
        const png = await readFile(join(out, stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Intro/outro real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
