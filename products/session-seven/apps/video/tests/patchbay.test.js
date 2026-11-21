import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PatchbayScene, PATCHBAY_EVENTS, PATCHBAY_CLI, PATCHBAY_LINES,
  getPatchbayTranscript, patchbayCaretVisible } from "../src/scenes/PatchbayScene.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { getScenePresentation, SCENE_LAYOUT } from "../src/SceneFrame.jsx";
import { Cli } from "../src/ui.jsx";
import { UI, FONT_SIZES, contrastRatio } from "../src/theme.js";
import { FIXTURES, sceneStartFrame, sceneEndFrame } from "../src/timeline.js";
import { stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const code = await readFile(join(videoDir, "src/scenes/PatchbayScene.jsx"), "utf8");
const FORBIDDEN_RENDER = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|new\s+Date\b|https?:\/\//;
const FORBIDDEN_CLAIMS = /\b(?:written|done|saved|success|dashboard|Send|currency|cash|deposit|withdrawal)\b|agent\s+running|remote[- ]service|integration\s+(?:live|connected)|name=["']check["']/i;
const markup = (frame) => renderToStaticMarkup(React.createElement("svg", null,
  React.createElement(Cli, { lines: getPatchbayTranscript(frame), ...PATCHBAY_CLI })));

 describe("Patchbay CLI illustration", () => {
  test("named scene is registered and uses exactly one shared CLI, no GUI", () => {
    expect(typeof PatchbayScene).toBe("function");
    expect(SCENE_COMPONENTS.patchbay).toBe(PatchbayScene);
    expect(code).toContain('<SceneFrame sceneId="patchbay">');
    expect(code).toContain("useCurrentFrame()");
    expect(code.match(/<Cli\b/g)).toHaveLength(1);
    expect(code).not.toMatch(/\b(?:Window|Panel|Row|Button|Icon)\b|<svg\b|from\s+["']\.\/.*Scene/);
  });

  test("event constants match exact local and absolute action frames", () => {
    expect(PATCHBAY_EVENTS).toEqual({ discovery: 30, inspectableResult: 120,
      writeRequest: 165, awaitingApproval: 180 });
    expect(660 + PATCHBAY_EVENTS.inspectableResult).toBe(780);
    expect(code).toContain("opacity={enter(frame, at, 0)}");
    expect(Object.isFrozen(PATCHBAY_EVENTS)).toBe(true);
  });

  test("discovery first appears at local 30 / absolute 690", () => {
    expect(getPatchbayTranscript(0)).toEqual(["Local demo · not executed"]);
    expect(getPatchbayTranscript(29)).toHaveLength(1);
    expect(getPatchbayTranscript(30)).toEqual(["Local demo · not executed", "› patchbay plugin list"]);
    expect(getPatchbayTranscript(119)).toHaveLength(2);
  });

  test("inspectable plugin name and read-only capability appear together at exactly 120", () => {
    expect(getPatchbayTranscript(119).join("\n")).not.toContain("Plugin:");
    expect(getPatchbayTranscript(120)).toEqual(["Local demo · not executed", "› patchbay plugin list",
      "Plugin: workspace-scout", "read-only workspace search"]);
    expect(getPatchbayTranscript(164)).toHaveLength(4);
    expect(FIXTURES.patchbay.note).toContain("Fake, sanitized");
  });

  test("write request precedes the pending approval state; no write executes", () => {
    expect(getPatchbayTranscript(165).at(-1)).toBe("Write request: sample-note.txt");
    expect(getPatchbayTranscript(179)).toHaveLength(5);
    expect(getPatchbayTranscript(180).at(-1)).toBe("Write paused: approve? [y/N]");
    for (let frame = 180; frame < 240; frame++) {
      const lines = getPatchbayTranscript(frame);
      expect(lines).toHaveLength(6);
      expect(lines.at(-1)).toBe("Write paused: approve? [y/N]");
      expect(lines.join("\n")).not.toMatch(FORBIDDEN_CLAIMS);
    }
    for (const frame of [210, 239]) expect(getPatchbayTranscript(frame).at(-1)).toContain("[y/N]");
  });

  test("block caret blinks from frames only, approval words stay fixed", () => {
    expect(patchbayCaretVisible(179)).toBe(false);
    expect(patchbayCaretVisible(180)).toBe(true);
    expect(patchbayCaretVisible(195)).toBe(false);
    expect(patchbayCaretVisible(210)).toBe(true);
    expect(patchbayCaretVisible(239)).toBe(true);
    expect(code).toContain("width={24} height={48} dark");
    for (const frame of [239, 180, 195, 210, 239])
      expect(patchbayCaretVisible(frame)).toBe(patchbayCaretVisible(frame));
  });

  test("no runtime I/O, clocks, randomness, live claims, completed writes or colored UI", () => {
    expect(code).not.toMatch(FORBIDDEN_RENDER);
    expect(code).not.toMatch(FORBIDDEN_CLAIMS);
    expect(code).not.toMatch(/stroke|border|outline|divider|PALETTE\.|#[\da-fA-F]{6}/);
    for (let frame = 0; frame < 240; frame++) {
      expect(getPatchbayTranscript(frame).join("\n")).not.toMatch(FORBIDDEN_CLAIMS);
    }
    for (const bad of ["written", "done", "saved", "success", "agent running", "remote-service", 'name="check"'])
      expect(FORBIDDEN_CLAIMS.test(bad)).toBe(true);
  });

  test("fixed caption and Concept/Illustrated UI labels cover every scene frame", () => {
    for (let frame = 0; frame < 240; frame++) {
      const view = getScenePresentation("patchbay", frame);
      expect(view.caption.text).toBe("Patchbay — Local agents.\nInspectable plugins.");
      expect(view.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(view.geometry.lines).toHaveLength(2);
      expect(view.geometry.fontSize).toBeGreaterThanOrEqual(48);
      expect(view.scene.status).toBe("concept");
      expect(view.scene.evidenceRef).toBeNull();
      expect(sceneStartFrame(view.scene)).toBe(660);
      expect(sceneEndFrame(view.scene)).toBe(900);
    }
    expect(getScenePresentation("patchbay", 240).caption).toBeUndefined();
  });

  test("six short 48px lines and caret fit the illustration, clear of fixed overlays", () => {
    expect(PATCHBAY_LINES).toHaveLength(6);
    expect(PATCHBAY_LINES.every(({ text }) => text.length <= 30 && !text.includes("\n"))).toBe(true);
    const box = SCENE_LAYOUT.illustration;
    expect(PATCHBAY_CLI.x).toBeGreaterThanOrEqual(box.x);
    expect(PATCHBAY_CLI.y).toBeGreaterThanOrEqual(box.y);
    expect(PATCHBAY_CLI.x + PATCHBAY_CLI.width).toBeLessThanOrEqual(box.right);
    expect(PATCHBAY_CLI.y + PATCHBAY_CLI.height).toBeLessThanOrEqual(box.bottom);
    expect(PATCHBAY_CLI.firstBaseline + 5 * PATCHBAY_CLI.lineHeight + 16).toBeLessThan(PATCHBAY_CLI.height);
    expect(PATCHBAY_CLI.caretX).toBeGreaterThan(40 + 686.18); // Inter 600 at 48px: measured bundled glyph advance.
    expect(PATCHBAY_CLI.caretX + 24).toBeLessThan(PATCHBAY_CLI.width - 40);
    expect(contrastRatio(UI.card, UI.ink)).toBeGreaterThanOrEqual(4.5);
    expect(FONT_SIZES.ui).toBe(48);
    for (const match of markup(239).matchAll(/font-size="(\d+)"/g))
      expect(Number(match[1])).toBeGreaterThanOrEqual(48);
    expect(markup(239)).not.toMatch(/stroke|border|outline|divider/i);
  });

  test("transcript derivation is immutable and stable under shuffled frames", () => {
    expect(Object.isFrozen(PATCHBAY_LINES)).toBe(true);
    expect(PATCHBAY_LINES.every(Object.isFrozen)).toBe(true);
    const gold = new Map([0, 30, 119, 120, 165, 180, 210, 239].map((frame) => [frame, getPatchbayTranscript(frame)]));
    for (const frame of [239, 30, 180, 0, 120, 119, 165, 210, 239])
      expect(getPatchbayTranscript(frame)).toEqual(gold.get(frame));
    const changed = getPatchbayTranscript(239);
    changed.pop();
    expect(getPatchbayTranscript(239)).toHaveLength(6);
  });

  test("real pinned Chromium smoke renders action and both approval frames within 90s", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-patchbay-smoke-"));
    const frames = [780, 870, 899];
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "patchbay", "--frames", frames.join(","), "--out", out],
    { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      expect(stdout).toContain("concurrency=1");
      expect((await readdir(join(out, "patchbay"))).sort()).toEqual(frames.map(stillFilename).sort());
      for (const frame of frames) {
        const png = await readFile(join(out, "patchbay", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Patchbay still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
