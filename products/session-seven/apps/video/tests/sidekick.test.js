import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { SidekickScene, SIDEKICK_COPY, SIDEKICK_FRAMES, sidekickState } from "../src/scenes/SidekickScene.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { getScenePresentation } from "../src/SceneFrame.jsx";
import { FIXTURES, SCENES, sceneEndFrame, sceneStartFrame } from "../src/timeline.js";
import { parseStillOptions, stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const code = await readFile(join(videoDir, "src/scenes/SidekickScene.jsx"), "utf8");
const FORBIDDEN_RENDER = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b|useEffect|useState|https?:\/\//;
const FORBIDDEN_CLAIMS = /\bautonomous\b|automatically\s+completes|extension\s+(?:installed|live)|live[- ]extension|approval[- ]free|\bsubmitted\b|\bdone\b|name=["']check["']|\bSend\b|\b(?:USD|cash|deposit|withdrawal|currency)\b|[$€£]/i;

describe("Sidekick supervised browser illustration", () => {
  test("named scene export uses the existing registry and wrapper", () => {
    expect(typeof SidekickScene).toBe("function");
    expect(SCENE_COMPONENTS.sidekick).toBe(SidekickScene);
    expect(code).toContain('<SceneFrame sceneId="sidekick">');
    expect(code).toContain("useCurrentFrame()");
    expect(code).not.toMatch(/from\s+["']\.\/.*Scene/);
    for (const primitive of ["Window", "Panel", "Row", "Button", "TextLine", "Icon", "Pip"])
      expect(code).toContain(`<${primitive}`);
  });

  test("beat-derived plan/action/approval frames are exactly 15/30/120/180", () => {
    expect(SIDEKICK_FRAMES).toEqual({ planStart: 15, planReady: 30, action: 120, approval: 180 });
    expect(Object.isFrozen(SIDEKICK_FRAMES)).toBe(true);
    expect(sidekickState(0).planOpacity).toBe(0);
    expect(sidekickState(15).planOpacity).toBe(0);
    expect(sidekickState(30).planOpacity).toBe(1);
    expect(sidekickState(119).actionVisible).toBe(false);
    expect(sidekickState(120).actionVisible).toBe(true);
    expect(code).toContain("enter(frame, SIDEKICK_FRAMES.action, 0)");
    expect(sidekickState(179).approvalPending).toBe(false);
    expect(sidekickState(180).approvalPending).toBe(true);
    expect(sidekickState(210).approvalPending).toBe(true);
    expect(sidekickState(239).approvalPending).toBe(true);
  });

  test("all 240 frames keep the consequential step unexecuted", () => {
    for (let frame = 0; frame < 240; frame++) {
      expect(sidekickState(frame).gatedStepExecuted).toBe(false);
      expect(sidekickState(frame).approvalPending).toBe(frame >= 180);
      expect(sidekickState(frame).actionVisible).toBe(frame >= 120);
    }
    expect(code).toContain('data-gate="pending"');
    expect(code).toContain('data-executed={state.gatedStepExecuted}');
    expect(code).toContain('data-approval="pending"');
    expect(code).toContain('text="Approve?"');
    expect(code).toContain('label="Approve" variant="secondary"');
    expect(code).toContain('label="Reject" variant="secondary"');
    expect(code).toContain('name="lock"');
    expect(code).toContain('name="hourglass"');
  });

  test("short sanitized browser copy and a two-step plan", () => {
    expect(FIXTURES.sidekick.note).toContain("Fake, sanitized");
    expect(SIDEKICK_COPY.pageTitle).toBe(FIXTURES.sidekick.pageTitle);
    expect(SIDEKICK_COPY.steps).toEqual(["1 Find heading", "2 Submit draft"]);
    expect(SIDEKICK_COPY.steps.length).toBeGreaterThanOrEqual(2);
    expect(SIDEKICK_COPY.steps.length).toBeLessThanOrEqual(3);
    expect(Object.isFrozen(SIDEKICK_COPY.steps)).toBe(true);
    for (const copy of [SIDEKICK_COPY.pageTitle, ...SIDEKICK_COPY.steps, SIDEKICK_COPY.heading, SIDEKICK_COPY.draft]) {
      expect(copy.length).toBeLessThanOrEqual(24);
      expect(copy).not.toMatch(FORBIDDEN_CLAIMS);
    }
  });

  test("no operational claims, wall clocks, network, external assets or interface lines", () => {
    expect(code).not.toMatch(FORBIDDEN_RENDER);
    expect(code).not.toMatch(FORBIDDEN_CLAIMS);
    expect(code).not.toMatch(/stroke|border|outline|divider|<line\b/i);
    expect(code).not.toMatch(/PALETTE\.|#[\da-f]{6}|fontSize=|<svg\b/i);
    for (const forbidden of ["autonomous", "automatically completes", "extension installed", "extension live", "live-extension", "submitted", 'name="check"', "Send", "USD"])
      expect(FORBIDDEN_CLAIMS.test(forbidden)).toBe(true);
  });

  test("exact caption and persistent Concept/Illustrated UI across [900,1140)", () => {
    const scene = SCENES.find(({ id }) => id === "sidekick");
    expect(sceneStartFrame(scene)).toBe(900);
    expect(sceneEndFrame(scene)).toBe(1140);
    for (let localFrame = 0; localFrame < 240; localFrame++) {
      const presentation = getScenePresentation("sidekick", localFrame);
      expect(presentation.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(presentation.caption.text.replace("\n", " ")).toBe("Sidekick — Browser actions, supervised.");
      expect(presentation.geometry.fontSize).toBe(60);
    }
    expect(getScenePresentation("sidekick", 240).caption).toBeUndefined();
  });

  test("frame state is deterministic in repeated and shuffled evaluation", () => {
    const frames = [0, 30, 119, 120, 179, 180, 210, 239];
    const expected = new Map(frames.map((frame) => [frame, sidekickState(frame)]));
    for (const frame of [239, 120, 0, 30, 210, 179, 119, 180, 120, 239])
      expect(sidekickState(frame)).toEqual(expected.get(frame));
    expect(sidekickState(210)).toEqual(sidekickState(239));
  });

  test("exact requested still list uses absolute frames and end-exclusive bounds", () => {
    const options = parseStillOptions(["--scene", "sidekick", "--frames", "900,930,1020,1110,1139"]);
    expect(options.frames).toEqual([900, 930, 1020, 1110, 1139]);
    expect(options.outputDir).toBe(join(productDir, "qa/stills/sidekick"));
    for (const frame of [899, 1140])
      expect(() => parseStillOptions(["--scene", "sidekick", "--frames", String(frame)])).toThrow();
  });

  test("real three-state pinned-Chromium PNG smoke stays within a 90s deadline", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-sidekick-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "sidekick", "--frames", "930,1020,1139", "--out", out],
    { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      for (const frame of [930, 1020, 1139]) {
        const png = await readFile(join(out, "sidekick", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Sidekick real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
