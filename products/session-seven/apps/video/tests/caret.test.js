import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CARET_ACTION_FRAME, CARET_LISTEN_FRAME, CARET_SETTLE_FRAME, CARET_SHORTCUT, CARET_TEXT, CaretScene, caretSceneState } from "../src/scenes/CaretScene.jsx";
import { getScenePresentation } from "../src/SceneFrame.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { SCENES, sceneEndFrame, sceneStartFrame } from "../src/timeline.js";
import { stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const sceneSource = () => readFile(join(videoDir, "src/scenes/CaretScene.jsx"), "utf8");
const prohibitedClaim = /\b(?:send|sent|sending|submit|submitted|submission|arrow|currency|deposit|withdrawal|cashout)\b|enter\s+to\s+send|control\s+(?:your|the)\s+computer|voice\s+commands|universal\s+voice/i;
const prohibitedRender = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b|https?:\/\/|useEffect|useState|<animate\b|animation\s*:/;

describe("Caret desktop dictation illustration", () => {
  test("named component keeps the caret scene registry and shared frame", async () => {
    expect(typeof CaretScene).toBe("function");
    expect(SCENE_COMPONENTS.caret).toBe(CaretScene);
    const code = await sceneSource();
    expect(code).toContain('<SceneFrame sceneId="caret">');
    expect(code).toContain("useCurrentFrame()");
    expect(code).not.toMatch(/from\s+["']\.\/.*Scene|<svg\b/);
    expect(code).toContain("<Window");
    expect(code).toContain("<Panel");
    expect(code).toContain("<Caret");
  });

  test("shortcut is the PRD keyboard cue with three keycap chips", async () => {
    expect(CARET_SHORTCUT).toEqual(["Ctrl", "Alt", "Space"]);
    const code = await sceneSource();
    expect(code).toContain('name="keyboard"');
    expect(code).toContain("data-keycap={label}");
    expect(code).toContain("<ShortcutCue />");
    expect(caretSceneState(0).phase).toBe("shortcut");
    expect(caretSceneState(29).phase).toBe("shortcut");
  });

  test("listening has the mic, listening Pip pose and held thought fixture", async () => {
    expect(CARET_LISTEN_FRAME).toBe(30);
    for (let frame = 30; frame < 120; frame++) {
      const state = caretSceneState(frame);
      expect(state.listening).toBe(true);
      expect(state.pose).toBe("listening");
      expect(state.inserted).toBe(false);
      expect(state.bubbleVisible).toBe(true);
    }
    const code = await sceneSource();
    expect(code).toContain('state.listening ? "mic"');
    expect(code).toContain('data-thought-bubble="dictation"');
  });

  test("the single insertion action starts at local 120, absolute 300", () => {
    const scene = SCENES.find(({ id }) => id === "caret");
    expect(sceneStartFrame(scene)).toBe(180);
    expect(sceneEndFrame(scene)).toBe(420);
    expect(CARET_ACTION_FRAME).toBe(120);
    expect(sceneStartFrame(scene) + CARET_ACTION_FRAME).toBe(300);
    expect(CARET_SETTLE_FRAME).toBe(135);
    expect(caretSceneState(119).inserted).toBe(false);
    expect(caretSceneState(120).inserted).toBe(true);
    expect(caretSceneState(120).transfer).toBe(0);
    expect(caretSceneState(134).bubbleVisible).toBe(true);
    expect(caretSceneState(135).bubbleVisible).toBe(false);
    expect(caretSceneState(135).transfer).toBe(1);
    for (let frame = 120; frame < 240; frame++) expect(caretSceneState(frame).inserted).toBe(true);
    expect(caretSceneState(210).phase).toBe("inserted");
    expect(caretSceneState(210).caretVisible).toBe(true);
  });

  test("meter is seeded and beat-stepped, caret is a slow static-frame blink", () => {
    expect(caretSceneState(30).bars).toEqual(caretSceneState(44).bars);
    expect(caretSceneState(30).bars).not.toEqual(caretSceneState(45).bars);
    for (const frame of [0, 30, 120, 210, 239, 120, 30, 0]) {
      const state = caretSceneState(frame);
      expect(state).toEqual(caretSceneState(frame));
      expect(state.bars).toHaveLength(5);
      for (const height of state.bars) expect([18, 30, 42, 54]).toContain(height);
    }
    for (let frame = 0; frame < 240; frame++) {
      expect(caretSceneState(frame).caretVisible).toBe(frame % 60 < 45);
    }
  });

  test("no delivery controls, delivery states, broad control claims or unsafe fixture", async () => {
    const code = await sceneSource();
    expect(code).not.toMatch(prohibitedClaim);
    expect(code).not.toMatch(/<Button\b|stroke|border|outline|divider|<line\b/i);
    expect(CARET_TEXT).toBe("Hello team");
    expect(CARET_TEXT.length).toBeLessThanOrEqual(12);
    expect(CARET_TEXT).not.toMatch(/@|https?:|\d{4}|api[_-]?key|token|secret|\$/i);
    for (const bad of ["Send", "sent", "Enter to send", "control your computer", "voice commands"]) expect(prohibitedClaim.test(bad)).toBe(true);
  });

  test("all motion is frame-derived and UI uses only shared neutral primitives", async () => {
    const code = await sceneSource();
    expect(code).not.toMatch(prohibitedRender);
    expect(code).not.toMatch(/PALETTE|#[0-9a-f]{3,8}|<image\b/i);
    expect(code).toContain("seeded(SEEDS.caret + Math.floor(frame / beat(1)))");
    expect(code).toContain("enter(frame, CARET_ACTION_FRAME, 0)");
    expect(code).toContain("translateIn(frame, CARET_ACTION_FRAME, beat(1)");
    expect(code).toContain("fill={UI.ink}");
  });

  test("exact caption, concept qualification and persistent labels cover all 240 frames", () => {
    for (let frame = 0; frame < 240; frame++) {
      const view = getScenePresentation("caret", frame);
      expect(view.caption.text).toBe("Caret — Speak.\nText at your caret.");
      expect(view.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(view.scene.status).toBe("concept");
      expect(view.scene.evidenceRef).toBeNull();
      expect(view.scene.claim).toStartWith("Exploring desktop dictation:");
      expect(view.geometry.fontSize).toBeGreaterThanOrEqual(48);
    }
    expect(getScenePresentation("caret", -1).caption).toBeUndefined();
    expect(getScenePresentation("caret", 240).caption).toBeUndefined();
  });

  test("real 3-frame scoped PNG smoke within a 90-second deadline", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-caret-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "caret", "--frames", "180,210,300", "--out", out],
      { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      console.log(`Caret real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s exit=${code}\n${stdout.trim()}\n${stderr.trim()}`);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      expect(await readdir(join(out, "caret"))).toHaveLength(3);
      for (const frame of [180, 210, 300]) {
        const png = await readFile(join(out, "caret", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
