import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { GlassroomScene, GlassroomArtwork, GLASSROOM_ACTION_FRAME, GLASSROOM_RESULT_FRAME,
  GLASSROOM_SAMPLE, GLASSROOM_LAYOUT, getGlassroomState } from "../src/scenes/GlassroomScene.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { getScenePresentation, SCENE_LAYOUT } from "../src/SceneFrame.jsx";
import { SCENES, sceneStartFrame, sceneEndFrame } from "../src/timeline.js";
import { stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const sceneSource = () => readFile(join(videoDir, "src/scenes/GlassroomScene.jsx"), "utf8");
const markupAt = (frame) => renderToStaticMarkup(React.createElement("svg", null,
  React.createElement(GlassroomArtwork, { frame })));
const FORBIDDEN_CLAIMS = /\b(?:anonymous|anonymity|untraceable|untraceability|endpoint|secure\s+device|verified|live|delivered|delivery|proof|audited)\b/i;
const FORBIDDEN_ICONS = /\b(?:shield|check)\b/i;
const FORBIDDEN_RENDER = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b|https?:\/\/|WebCrypto|crypto\.subtle|WebRTC|WebSocket/;
const FORBIDDEN_UI = /stroke|border|outline|<line\b|divider/i;

describe("Glassroom paired-message illustration", () => {
  test("exports and registers the assigned scene without another scene dependency", async () => {
    expect(typeof GlassroomScene).toBe("function");
    expect(SCENE_COMPONENTS.glassroom).toBe(GlassroomScene);
    const source = await sceneSource();
    expect(source).toContain('<SceneFrame sceneId="glassroom">');
    expect(source).toContain("useCurrentFrame()");
    expect(source).toContain('<GlassroomArtwork frame={frame} />');
    expect(source).not.toMatch(/from\s+["']\.\/.*Scene/);
    const scene = SCENES.find(({ id }) => id === "glassroom");
    expect(sceneStartFrame(scene)).toBe(1380);
    expect(sceneEndFrame(scene)).toBe(1620);
  });

  test("source and every rendered artwork exclude unsupported wording and security badges", async () => {
    const source = await sceneSource();
    expect(source).not.toMatch(FORBIDDEN_CLAIMS);
    expect(source).not.toMatch(FORBIDDEN_ICONS);
    for (let frame = 0; frame < 240; frame++) {
      const markup = markupAt(frame);
      expect(markup).not.toMatch(FORBIDDEN_CLAIMS);
      expect(markup).not.toMatch(FORBIDDEN_ICONS);
    }
    for (const word of ["anonymous", "untraceable", "endpoint", "secure device", "verified", "live", "delivered", "proof"])
      expect(FORBIDDEN_CLAIMS.test(word)).toBe(true);
    for (const icon of ["shield", "check"]) expect(FORBIDDEN_ICONS.test(icon)).toBe(true);
  });

  test("exactly two participant windows, each with one short plaintext, persist through all 240 frames", () => {
    for (let frame = 0; frame < 240; frame++) {
      const markup = markupAt(frame);
      expect(markup.match(/data-participant=/g)?.length).toBe(2);
      expect(markup.match(/<rect[^>]*width="560"[^>]*height="354"/g)?.length).toBe(2);
      expect(markup).toContain('data-participant="left"');
      expect(markup).toContain('data-participant="right"');
      expect(markup).toContain(">You</text>");
      expect(markup).toContain(">Friend</text>");
      expect(markup.match(/>Sample text<\/text>/g)?.length).toBe(2);
      expect(markup.match(/>Hello friend<\/text>/g)?.length).toBe(frame < GLASSROOM_RESULT_FRAME ? 1 : 2);
      expect(markup.includes(">Hi there</text>")).toBe(frame < GLASSROOM_RESULT_FRAME);
      expect(markup.match(/data-pip-body="capsule"/g)?.length).toBe(1);
    }
    expect(GLASSROOM_SAMPLE.message).toBe("Hello friend");
    expect(GLASSROOM_SAMPLE.reply).toBe("Hi there");
    expect(Object.isFrozen(GLASSROOM_SAMPLE)).toBe(true);
    expect(Object.isFrozen(GLASSROOM_SAMPLE.glyphs)).toBe(true);
  });

  test("ciphertext drawing starts visibly at local 120 / absolute 1500, never one frame late", () => {
    expect(GLASSROOM_ACTION_FRAME).toBe(120);
    expect(1380 + GLASSROOM_ACTION_FRAME).toBe(1500);
    for (let frame = 0; frame < 240; frame++) {
      const visible = frame >= GLASSROOM_ACTION_FRAME;
      expect(getGlassroomState(frame).drawingVisible).toBe(visible);
      const markup = markupAt(frame);
      expect(markup.includes('data-ciphertext="illustrative"')).toBe(visible);
      expect(markup.includes('data-ui-icon="lock"')).toBe(visible);
      expect(markup.includes(">Illustrative</text>")).toBe(visible);
      expect(markup.includes(">ciphertext</text>")).toBe(visible);
    }
    const action = markupAt(120);
    expect(action).not.toMatch(/opacity="0"/);
    for (const glyph of GLASSROOM_SAMPLE.glyphs) expect(action).toContain(`>${glyph}</text>`);
  });

  test("matching sample appears in the receiving view and holds for the last two seconds", () => {
    expect(GLASSROOM_RESULT_FRAME).toBe(180);
    expect(240 - GLASSROOM_RESULT_FRAME).toBeGreaterThanOrEqual(60);
    expect(getGlassroomState(179).resultVisible).toBe(false);
    expect(getGlassroomState(180).resultVisible).toBe(true);
    for (const frame of [180, 210, 239]) {
      const markup = markupAt(frame);
      const right = markup.slice(markup.indexOf('data-participant="right"'), markup.indexOf('data-ciphertext='));
      expect(right).toContain(">Hello friend</text>");
      expect(right).not.toContain(">Hi there</text>");
      expect(markup).toContain('data-pip-pose="happy"');
    }
  });

  test("exact caption and truthful persistent labels cover the whole end-exclusive scene", () => {
    for (let frame = 0; frame < 240; frame++) {
      const presentation = getScenePresentation("glassroom", frame);
      expect(presentation.caption.text.replaceAll("\n", " ")).toBe("Glassroom — Two people. Encrypted text.");
      expect(presentation.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(presentation.scene.status).toBe("concept");
      expect(presentation.scene.evidenceRef).toBeNull();
    }
    expect(getScenePresentation("glassroom", -1).caption).toBeUndefined();
    expect(getScenePresentation("glassroom", 240).caption).toBeUndefined();
  });

  test("safe geometry, monochrome surfaces, native reading size and no render-time APIs", async () => {
    for (const rect of Object.values(GLASSROOM_LAYOUT)) {
      expect(rect.x).toBeGreaterThanOrEqual(SCENE_LAYOUT.illustration.x);
      expect(rect.y).toBeGreaterThanOrEqual(SCENE_LAYOUT.illustration.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(SCENE_LAYOUT.illustration.right);
      expect(rect.y + rect.height + 12).toBeLessThanOrEqual(SCENE_LAYOUT.illustration.bottom);
    }
    const source = await sceneSource();
    expect(source).not.toMatch(FORBIDDEN_UI);
    expect(source).not.toMatch(FORBIDDEN_RENDER);
    expect(source).not.toMatch(/#[\dA-Fa-f]{6}|PALETTE\.(?:Sun|Mint)/);
    const markup = markupAt(120);
    expect(markup).not.toMatch(FORBIDDEN_UI);
    for (const size of markup.matchAll(/font-size="(\d+)"/g)) expect(Number(size[1])).toBeGreaterThanOrEqual(48);
  });

  test("frame-only state and settled SVG are stable in repeated and shuffled order", () => {
    const states = new Map([0, 30, 119, 120, 135, 179, 180, 210, 239].map((frame) => [frame, markupAt(frame)]));
    for (const frame of [239, 120, 0, 210, 119, 180, 30, 135, 179, 120]) expect(markupAt(frame)).toBe(states.get(frame));
    expect(markupAt(30)).toBe(markupAt(119));
    expect(markupAt(135)).toBe(markupAt(179));
    expect(markupAt(180)).toBe(markupAt(239));
  });

  test("real pinned-Chromium scene smoke renders three native PNGs within 90 seconds", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-glassroom-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "glassroom", "--frames", "1410,1500,1590", "--out", out],
    { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      for (const frame of [1410, 1500, 1590]) {
        const png = await readFile(join(out, "glassroom", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Glassroom real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
