export const BENCHMARK_FRAMES = 240;
export const FULL_FILM_FRAMES = 1800;
export const BENCHMARK_STILL_FRAMES = Object.freeze([30, 150, 239]);

export function projectRender(wallTimeSeconds, frameCount = BENCHMARK_FRAMES) {
  if (!Number.isFinite(wallTimeSeconds) || wallTimeSeconds <= 0) {
    throw new Error("wallTimeSeconds must be positive and finite");
  }
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error("frameCount must be a positive integer");
  }
  const secondsPerFrame = wallTimeSeconds / frameCount;
  const projectedFullFilm1800FramesSeconds = secondsPerFrame * FULL_FILM_FRAMES;
  return {
    secondsPerFrame,
    projectedFullFilm1800FramesSeconds,
    projectedFullFilm1800FramesMinutes: projectedFullFilm1800FramesSeconds / 60,
  };
}

export function createBenchmarkReport(run, toolchain, outputs, runs = [run]) {
  return {
    ...run,
    ...projectRender(run.wallTimeSeconds, run.frameCount || BENCHMARK_FRAMES),
    toolchain,
    outputs,
    runs: runs.map((measured) => ({
      ...measured,
      ...projectRender(measured.wallTimeSeconds, measured.frameCount || BENCHMARK_FRAMES),
    })),
    decisionBasis: "concurrency-2 baseline; comparison does not replace the conservative estimate",
    timingScope: "renderMedia wall time including all frames and H.264 encode; bundle/select/stills excluded",
  };
}

export function remainingBuildMinutes(at, startedAt = "2026-11-21T21:44:00+08:00") {
  const current = new Date(at).getTime();
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(current) || !Number.isFinite(start)) throw new Error("Invalid build clock");
  return Math.max(0, (start + 6 * 60 * 60 * 1000 - current) / 60000);
}

export function feasibilityDecision(projectedMinutes, remainingMinutes) {
  if (![projectedMinutes, remainingMinutes].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Feasibility durations must be finite and nonnegative");
  }
  return projectedMinutes <= remainingMinutes ? "PASS" : "FAIL";
}
