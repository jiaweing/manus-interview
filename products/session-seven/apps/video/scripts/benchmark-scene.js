import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { cpus, loadavg, tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { BENCHMARK_FRAMES, BENCHMARK_STILL_FRAMES, createBenchmarkReport } from "./benchmark-helpers.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const qaDir = join(productDir, "qa");
const stillDir = join(qaDir, "benchmark");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--compare")) throw new Error("Usage: bun run benchmark:scene [--compare]");
const concurrencies = args.includes("--compare") ? [2, 4] : [2];
const benchmarkStartedAt = new Date().toISOString();
console.log(`Benchmark start ${benchmarkStartedAt} cpuCount=${cpus().length} loadAvg=${JSON.stringify(loadavg())}`);
await mkdir(stillDir, { recursive: true });

// Verify the actual executable/dependency/font identities, not just declarations.
const verification = spawnSync(process.execPath, [join(videoDir, "scripts/verify-toolchain.js")], {
  cwd: productDir, encoding: "utf8", env: process.env,
});
await writeFile(join(qaDir, "benchmark-toolchain.txt"), `${verification.stdout || ""}${verification.stderr || ""}`);
if (verification.status !== 0) throw new Error("Pinned toolchain check failed; see qa/benchmark-toolchain.txt");
const toolchain = JSON.parse(await readFile(join(qaDir, "toolchain.json"), "utf8"));
const temporaryDir = await mkdtemp(join(tmpdir(), "s7-benchmark-"));
const browserLogs = [];
const runs = [];
let stage = "bundle";
let activeRun = null;
let failure = null;
const onBrowserLog = (log) => {
  // Remotion 4.0.545 forwards Runtime.exceptionThrown as type:error here as well.
  browserLogs.push({ stage, type: log.type, text: log.text, stackTrace: log.stackTrace });
  if (log.type === "error") console.error(`Browser/page error (${stage}): ${log.text}`);
};
const rendererOptions = {
  browserExecutable: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  chromiumOptions: { gl: "swangle" },
  onBrowserLog,
  logLevel: "error",
};
let bundleSeconds = 0;
let selectSeconds = 0;
let stillSeconds = 0;
const outputs = {
  stills: BENCHMARK_STILL_FRAMES.map((frame) => `qa/benchmark/frame-${String(frame).padStart(3, "0")}.png`),
  browserLog: "qa/benchmark/browser-log.json",
  temporaryMedia: { codec: "h264", location: "os.tmpdir()/s7-benchmark-*/benchmark-c*.mp4", deleted: false },
};
try {
  const bundleStart = performance.now();
  const serveUrl = await bundle({
    entryPoint: join(videoDir, "src/benchmark/index.js"),
    publicDir: join(videoDir, "public"),
    outDir: join(temporaryDir, "bundle"),
  });
  bundleSeconds = (performance.now() - bundleStart) / 1000;
  stage = "selectComposition";
  const selectStart = performance.now();
  const composition = await selectComposition({ ...rendererOptions, serveUrl, id: "Benchmark" });
  selectSeconds = (performance.now() - selectStart) / 1000;
  if (composition.durationInFrames !== BENCHMARK_FRAMES || composition.width !== 1920
    || composition.height !== 1080 || composition.fps !== 30) throw new Error("Invalid Benchmark composition");

  for (const concurrency of concurrencies) {
    stage = `renderMedia-c${concurrency}`;
    activeRun = {
      frameCount: 0, renderErrors: 0, concurrency,
      cpuCount: cpus().length, loadAvg: loadavg(), startedAt: new Date().toISOString(),
    };
    const errorsBefore = browserLogs.filter((log) => log.type === "error").length;
    const started = performance.now();
    let lastReported = -1;
    console.log(`Render start concurrency=${concurrency} cpuCount=${activeRun.cpuCount} loadAvg=${JSON.stringify(activeRun.loadAvg)}`);
    try {
      await renderMedia({
        ...rendererOptions, composition, serveUrl, codec: "h264", pixelFormat: "yuv420p",
        outputLocation: join(temporaryDir, `benchmark-c${concurrency}.mp4`),
        concurrency, frameRange: [0, BENCHMARK_FRAMES - 1], muted: true,
        onProgress: ({ renderedFrames }) => {
          activeRun.frameCount = Math.max(activeRun.frameCount, renderedFrames);
          const progressStep = Math.floor(renderedFrames / 60);
          if (progressStep > lastReported) {
            console.log(`Render c${concurrency}: ${renderedFrames}/${BENCHMARK_FRAMES} frames`);
            lastReported = progressStep;
          }
        },
      });
    } finally {
      activeRun.wallTimeSeconds = (performance.now() - started) / 1000;
      activeRun.finishedAt = new Date().toISOString();
      activeRun.renderErrors = browserLogs.filter((log) => log.type === "error").length - errorsBefore;
      runs.push(activeRun);
    }
    if (activeRun.frameCount !== BENCHMARK_FRAMES) throw new Error(`Only ${activeRun.frameCount} frames completed`);
    console.log(`Measured c${concurrency}: ${activeRun.wallTimeSeconds.toFixed(3)} seconds`);
  }

  const stillStart = performance.now();
  // Sequential stills use a single page, never concurrent still rendering.
  for (const frame of BENCHMARK_STILL_FRAMES) {
    stage = `renderStill-${frame}`;
    await renderStill({
      ...rendererOptions, composition, serveUrl, frame, imageFormat: "png",
      output: join(stillDir, `frame-${String(frame).padStart(3, "0")}.png`),
    });
    console.log(`Saved qa/benchmark/frame-${String(frame).padStart(3, "0")}.png`);
  }
  stillSeconds = (performance.now() - stillStart) / 1000;
} catch (error) {
  failure = error;
  browserLogs.push({ stage, type: "error", text: String(error), source: "renderer rejection" });
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
  outputs.temporaryMedia.deleted = true;
  await writeFile(join(stillDir, "browser-log.json"), `${JSON.stringify(browserLogs, null, 2)}\n`);
  if (runs.length) {
    const baseline = {
      ...runs[0], renderErrors: browserLogs.filter((log) => log.type === "error").length,
    };
    const report = {
      ...createBenchmarkReport(baseline, toolchain, outputs, runs),
      benchmarkStartedAt, benchmarkFinishedAt: new Date().toISOString(),
      pipelineSeconds: { bundle: bundleSeconds, selectComposition: selectSeconds, stills: stillSeconds },
      ...(failure ? { failure: String(failure) } : {}),
    };
    await writeFile(join(qaDir, "benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (report.renderErrors > 0 && !failure) failure = new Error(`${report.renderErrors} browser/render errors`);
  } else if (failure) {
    await writeFile(join(qaDir, "benchmark.json"), `${JSON.stringify({
      frameCount: 0, renderErrors: browserLogs.filter((log) => log.type === "error").length,
      toolchain, benchmarkStartedAt, benchmarkFinishedAt: new Date().toISOString(), outputs,
      failure: String(failure),
    }, null, 2)}\n`);
  }
}
if (failure) throw failure;
console.log(`PASS benchmark:scene frameCount=${runs[0].frameCount} renderErrors=0 concurrency=2 temporaryMediaDeleted=true`);
