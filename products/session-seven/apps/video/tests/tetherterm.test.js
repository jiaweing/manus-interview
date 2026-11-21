import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ACTION_FRAME, OUTPUT_FRAME, SESSION_ID, HISTORY, TETHERTERM_LAYOUT,
  getTetherTermState, TetherTermScene, TetherTermTerminal } from "../src/scenes/TetherTermScene.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { SCENE_LAYOUT, getScenePresentation } from "../src/SceneFrame.jsx";
import { FIXTURES, SCENES, sceneStartFrame, sceneEndFrame } from "../src/timeline.js";
import { UI, contrastRatio } from "../src/theme.js";
import { parseStillOptions, stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const scene = SCENES.find(({ id }) => id === "tetherterm");
const markup = (frame) => renderToStaticMarkup(React.createElement("svg", null,
  React.createElement(TetherTermTerminal, { frame })));
const source = () => readFile(join(videoDir, "src/scenes/TetherTermScene.jsx"), "utf8");
const forbiddenRender = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b|WebSocket|useEffect|useState|https?:\/\//;
const forbiddenClaims = /\b(?:dashboard|live|connected|real\s+(?:terminal|PTY)|terminal_create|new[- ]session|Send|currency|cash|deposit|withdrawal|payment)\b/i;
const forbiddenUi = /stroke|border|outline|divider|<line\b|<(?:Window|Panel|Row|Button)\b/i;

describe("TetherTerm persistent session illustration", () => {
  test("registered component retains the shared SceneFrame and locked interval", async () => {
    expect(typeof TetherTermScene).toBe("function");
    expect(SCENE_COMPONENTS.tetherterm).toBe(TetherTermScene);
    expect(sceneStartFrame(scene)).toBe(1140);
    expect(sceneEndFrame(scene)).toBe(1380);
    const code = await source();
    expect(code).toContain('<SceneFrame sceneId="tetherterm">');
    expect(code).toContain("useCurrentFrame()");
    expect(code).not.toMatch(/from\s+["']\.\/.*Scene/);
    expect(code.match(/<Cli\b/g)?.length).toBe(1);
  });

  test("input starts exactly at local 120 and output holds from 180", () => {
    expect(ACTION_FRAME).toBe(120);
    expect(OUTPUT_FRAME).toBe(180);
    expect(sceneStartFrame(scene) + ACTION_FRAME).toBe(1260);
    expect(sceneStartFrame(scene) + OUTPUT_FRAME).toBe(1320);
    expect(getTetherTermState(119).inputAccepted).toBe(false);
    expect(getTetherTermState(119).input).toBe(">>>");
    expect(getTetherTermState(120).inputAccepted).toBe(true);
    expect(getTetherTermState(120).input).toBe(FIXTURES.tetherterm.inputText);
    expect(getTetherTermState(179).outputReady).toBe(false);
    expect(getTetherTermState(180).output).toBe("7");
    expect(240 - OUTPUT_FRAME).toBeGreaterThanOrEqual(60);
    expect(getTetherTermState(239).output).toBe("7");
  });

  test("all 240 frames retain one fixed identifier, all history and one terminal", () => {
    expect(SESSION_ID).toBe("demo-session-007");
    expect(HISTORY).toEqual([">>> sample = 6", ">>> sample * 7", "42"]);
    expect(Object.isFrozen(HISTORY)).toBe(true);
    for (let frame = 0; frame < 240; frame++) {
      const state = getTetherTermState(frame);
      const svg = markup(frame);
      expect(state.sessionId).toBe(SESSION_ID);
      expect(state.history).toBe(HISTORY);
      expect(svg.split(SESSION_ID).length - 1).toBe(1);
      expect(svg.match(/data-ui="cli-dark"/g)?.length).toBe(1);
      expect(svg).toContain(`<text x="40" y="78"`);
      expect(svg).toContain('data-role="retained-history"');
      for (const text of HISTORY) expect(svg).toContain(text.replaceAll(">", "&gt;"));
      expect(svg.includes('data-role="accepted-input"')).toBe(frame >= ACTION_FRAME);
      expect(svg.includes('data-role="matching-output"')).toBe(frame >= OUTPUT_FRAME);
    }
  });

  test("1170/1260/1350 comparison shows retained history and corresponding input/output", () => {
    const hold = getTetherTermState(1170 - 1140);
    const action = getTetherTermState(1260 - 1140);
    const result = getTetherTermState(1350 - 1140);
    expect([hold.sessionId, action.sessionId, result.sessionId]).toEqual(Array(3).fill(SESSION_ID));
    expect(hold.history).toEqual(action.history);
    expect(action.history).toEqual(result.history);
    expect(hold.inputAccepted).toBe(false);
    expect(action.input).toBe(">>> sample + 1");
    expect(action.output).toBeNull();
    expect(result.input).toBe(action.input);
    expect(result.output).toBe("7");
  });

  test("frame states are regenerated identically in repeated and shuffled order", () => {
    const frames = [239, 120, 0, 210, 30, 180, 119, 179, 120, 0];
    const baseline = new Map(frames.map((frame) => [frame, markup(frame)]));
    for (const frame of frames.toReversed()) {
      expect(markup(frame)).toBe(baseline.get(frame));
      expect(Object.isFrozen(getTetherTermState(frame))).toBe(true);
    }
  });

  test("exact caption and honest labels persist over every local frame", () => {
    for (let frame = 0; frame < 240; frame++) {
      const view = getScenePresentation("tetherterm", frame);
      expect(view.caption.text).toBe("TetherTerm — One terminal.\nOngoing control.");
      expect(view.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(view.geometry.fontSize).toBe(60);
      expect(view.scene.evidenceRef).toBeNull();
    }
  });

  test("native 48px short reading lines fit the illustration without movement", () => {
    const { terminal, session, history, input, output, prompt } = TETHERTERM_LAYOUT;
    const illustration = SCENE_LAYOUT.illustration;
    expect(terminal.x).toBeGreaterThanOrEqual(illustration.x);
    expect(terminal.y).toBeGreaterThanOrEqual(illustration.y);
    expect(terminal.x + terminal.width).toBeLessThanOrEqual(illustration.right);
    expect(terminal.y + terminal.height).toBeLessThanOrEqual(illustration.bottom);
    for (const point of [session, history, input, output, prompt]) {
      expect(point.x).toBe(40);
      expect(point.y).toBeGreaterThanOrEqual(48);
      expect(point.y).toBeLessThanOrEqual(terminal.height - 40);
    }
    expect([SESSION_ID, ...HISTORY, FIXTURES.tetherterm.inputText,
      FIXTURES.tetherterm.outputText].every((text) => text.length <= 18)).toBe(true);
    for (const match of markup(210).matchAll(/font-size="(\d+)"/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(48);
    expect(contrastRatio(UI.card, UI.ink)).toBeGreaterThanOrEqual(4.5);
  });

  test("source and visible text exclude extra UI, operational claims and impure render code", async () => {
    const code = await source();
    expect(code).not.toMatch(forbiddenRender);
    expect(code).not.toMatch(forbiddenClaims);
    expect(code).not.toMatch(forbiddenUi);
    expect(code).not.toMatch(/PALETTE\.|#[\dA-Fa-f]{6}|<svg\b|\b(?:exec|spawn)\s*\(/);
    expect(markup(210)).not.toMatch(forbiddenClaims);
    expect(markup(210)).not.toMatch(forbiddenUi);
    for (const bad of ["live", "connected to a real terminal", "dashboard", "terminal_create", "new-session", "Send", "currency", "cash"]) {
      expect(forbiddenClaims.test(bad)).toBe(true);
    }
    for (const bad of ["Math.random()", "Date.now()", "fetch(url)", "setTimeout(fn)"]) expect(forbiddenRender.test(bad)).toBe(true);
  });

  test("scene-scoped CLI accepts only its end-exclusive absolute frames", () => {
    expect(parseStillOptions(["--scene", "tetherterm", "--frames", "1140,1170,1260,1350,1379"]).frames)
      .toEqual([1140, 1170, 1260, 1350, 1379]);
    for (const frame of [1139, 1380]) {
      expect(() => parseStillOptions(["--scene", "tetherterm", "--frames", String(frame)])).toThrow();
    }
  });

  test("real pinned-Chromium smoke renders hold/action/result PNGs within 90s", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-tetherterm-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "tetherterm", "--frames", "1170,1260,1350", "--out", out],
    { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      for (const frame of [1170, 1260, 1350]) {
        const png = await readFile(join(out, "tetherterm", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`TetherTerm real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
