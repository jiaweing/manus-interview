import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_FRAMES, BENCHMARK_STILL_FRAMES, createBenchmarkReport,
  feasibilityDecision, projectRender, remainingBuildMinutes,
} from "../scripts/benchmark-helpers.js";
import { SCENES } from "../src/timeline.js";

const productDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const measuredFixture = {
  frameCount: 240, renderErrors: 0, wallTimeSeconds: 24, concurrency: 2,
  cpuCount: 6, loadAvg: [2, 3, 4],
  startedAt: "2026-11-21T14:20:00Z", finishedAt: "2026-11-21T14:20:24Z",
};
const toolchainFixture = { bun: "1.4.5", chromium: { version: "156.0.8078.73" }, remotion: { remotion: "4.0.545" } };

function expectReportShape(report) {
  expect(report.frameCount).toBe(BENCHMARK_FRAMES);
  expect(report.renderErrors).toBe(0);
  expect(report.wallTimeSeconds).toBeGreaterThan(0);
  expect(report.secondsPerFrame).toBeCloseTo(report.wallTimeSeconds / 240, 10);
  expect(report.projectedFullFilm1800FramesSeconds).toBeCloseTo(report.wallTimeSeconds * 7.5, 10);
  expect(report.projectedFullFilm1800FramesMinutes).toBeCloseTo(report.projectedFullFilm1800FramesSeconds / 60, 10);
  expect(report.concurrency).toBe(2);
  expect(report.cpuCount).toBeGreaterThan(0);
  expect(report.loadAvg).toHaveLength(3);
  expect(new Date(report.finishedAt).getTime()).toBeGreaterThan(new Date(report.startedAt).getTime());
  expect(report.toolchain.bun).toBe("1.4.5");
  expect(report.outputs.stills).toHaveLength(3);
  expect(report.outputs.temporaryMedia.deleted).toBe(true);
}

describe("benchmark pure helpers (no renderer or Chromium)", () => {
  test("240-frame measurement projects to all 1800 frames", () => {
    expect(projectRender(24)).toEqual({
      secondsPerFrame: 0.1, projectedFullFilm1800FramesSeconds: 180,
      projectedFullFilm1800FramesMinutes: 3,
    });
  });
  test("invalid measurement values are rejected", () => {
    for (const value of [0, -1, NaN, Infinity]) expect(() => projectRender(value)).toThrow();
    for (const value of [0, -1, 1.5, NaN]) expect(() => projectRender(24, value)).toThrow();
  });
  test("report helper produces qa/benchmark.json shape in a temporary fixture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "benchmark-unit-"));
    try {
      await mkdir(join(dir, "qa"));
      const output = join(dir, "qa/benchmark.json");
      const report = createBenchmarkReport(measuredFixture, toolchainFixture, {
        stills: BENCHMARK_STILL_FRAMES.map((frame) => `qa/benchmark/frame-${frame}.png`),
        temporaryMedia: { deleted: true },
      });
      await writeFile(output, JSON.stringify(report));
      expectReportShape(JSON.parse(await readFile(output, "utf8")));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("saved real QA report has the same contract, without re-rendering", async () => {
    expectReportShape(JSON.parse(await readFile(join(productDir, "qa/benchmark.json"), "utf8")));
  });
  test("comparison retains c2 as the conservative baseline and records both runs", () => {
    const report = createBenchmarkReport(measuredFixture, toolchainFixture, {}, [
      measuredFixture, { ...measuredFixture, concurrency: 4, wallTimeSeconds: 12 },
    ]);
    expect(report.concurrency).toBe(2);
    expect(report.runs.map((run) => run.concurrency)).toEqual([2, 4]);
    expect(report.runs[1].projectedFullFilm1800FramesMinutes).toBe(1.5);
  });
  test("six-hour window uses the supplied clock, clamps expired windows, and compares estimates", () => {
    expect(remainingBuildMinutes("2026-11-21T22:44:00+08:00")).toBe(300);
    expect(remainingBuildMinutes("2026-11-22T03:44:00+08:00")).toBe(0);
    expect(feasibilityDecision(3, 300)).toBe("PASS");
    expect(feasibilityDecision(301, 300)).toBe("FAIL");
    expect(feasibilityDecision(300, 300)).toBe("PASS");
    expect(() => remainingBuildMinutes("invalid")).toThrow();
    expect(() => feasibilityDecision(Infinity, 300)).toThrow();
  });
  test("fixture copies the locked two-line Caret caption and cannot pollute the Hero registry", async () => {
    const scene = await readFile(join(productDir, "apps/video/src/benchmark/BenchmarkScene.jsx"), "utf8");
    const root = await readFile(join(productDir, "apps/video/src/benchmark/Root.jsx"), "utf8");
    const filmRoot = await readFile(join(productDir, "apps/video/src/Root.jsx"), "utf8");
    const filmEntry = await readFile(join(productDir, "apps/video/src/index.js"), "utf8");
    const caption = SCENES.find((record) => record.id === "caret").captions[0].text;
    expect(caption.split("\n")).toHaveLength(2);
    for (const line of caption.split("\n")) expect(line.length).toBeLessThanOrEqual(38);
    expect(scene).toContain('SCENES.find((scene) => scene.id === "caret").captions[0].text');
    expect(scene).toContain("captionSize: 60, labelSize: 48, holdFrames: 240");
    expect(scene).toContain("document.fonts.load");
    expect(scene).toContain("delayRender(");
    expect(scene).toContain("continueRender(");
    expect(scene).toContain("interpolate(frame, [60, 90], [80, 0]");
    expect(scene).not.toMatch(/\b(?:Date\.now|Math\.random|setTimeout|setInterval|fetch)\s*\(/);
    expect(root).toContain('id="Benchmark"');
    expect(root).toContain("durationInFrames={240}");
    expect(filmRoot).not.toContain("benchmark");
    expect(filmEntry).not.toContain("benchmark");
  });
  test("caption/labels and interface text keep at least 4.5:1 contrast", async () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
      const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    for (const [foreground, background] of [["#20212B", "#FFF7E8"], ["#18181B", "#F4F4F5"], ["#18181B", "#FAFAFA"]]) {
      const [dark, light] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    const scene = await readFile(join(productDir, "apps/video/src/benchmark/BenchmarkScene.jsx"), "utf8");
    expect(scene).toContain('y="604" fill="#18181B" fontSize="48"');
  });
});
