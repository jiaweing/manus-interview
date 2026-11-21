import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { FILM } from "../src/film-config.js";
import { SCENES, TOTAL_FRAMES, sceneEndFrame, sceneStartFrame } from "../src/timeline.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
export const PRIMITIVES_FRAMES = Object.freeze([0, 60, 120, 180]);
const USAGE = "Usage: bun run preview:stills --frames 0,30,150 [--scene <id>] [--out <dir>] | --group primitives [--frames 0,60,120,180] [--out <dir>]";

export function parseStillOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--frames", "--scene", "--group", "--out"].includes(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`);
    const key = flag.slice(2);
    if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}. ${USAGE}`);
    options[key] = value;
  }
  if (options.group && options.group !== "primitives") throw new Error(`Unknown group: ${options.group}`);
  if (options.group && options.scene) throw new Error("--scene and --group cannot be combined");
  if (options.scene && !options.frames) throw new Error("--scene requires --frames (absolute Hero frames)");
  if (!options.frames && !options.group) throw new Error(`No frames requested. ${USAGE}`);
  const frames = options.frames ? options.frames.split(",").map((value) => {
    if (!/^\d+$/.test(value)) throw new Error(`Invalid frame: ${JSON.stringify(value)}`);
    const frame = Number(value);
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= TOTAL_FRAMES) throw new Error(`Frame ${value} outside 0..${TOTAL_FRAMES - 1}`);
    return frame;
  }) : [...PRIMITIVES_FRAMES];
  if (frames.length === 0 || new Set(frames).size !== frames.length) throw new Error("Empty or duplicate frame selection");
  if (options.group && frames.some((frame) => frame >= 240)) throw new Error("Primitives gallery frames must lie in 0..239");
  if (options.scene) {
    const scene = SCENES.find((record) => record.id === options.scene);
    if (!scene) throw new Error(`Unknown scene: ${options.scene}`);
    for (const frame of frames) {
      if (frame < sceneStartFrame(scene) || frame >= sceneEndFrame(scene)) {
        throw new Error(`Frame ${frame} outside ${scene.id} [${sceneStartFrame(scene)},${sceneEndFrame(scene)})`);
      }
    }
  }
  const baseOut = resolve(productDir, options.out ?? "qa/stills");
  return Object.freeze({
    frames: Object.freeze(frames), scene: options.scene, group: options.group,
    outputDir: options.group ? join(baseOut, "primitives") : options.scene ? join(baseOut, options.scene) : baseOut,
    entryPoint: join(videoDir, options.group ? "src/gallery/index.js" : "src/index.js"),
    compositionId: options.group ? "PrimitivesGallery" : FILM.compositionId,
    durationInFrames: options.group ? 240 : TOTAL_FRAMES,
  });
}
export const stillFilename = (frame) => `frame-${String(frame).padStart(4, "0")}.png`;

export async function renderPreview(options) {
  const started = performance.now();
  const tempDir = await mkdtemp(join(tmpdir(), "s7-stills-"));
  let browser;
  const errors = [];
  const rendererOptions = {
    browserExecutable: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    chromiumOptions: { gl: "swangle" }, logLevel: "error",
    onBrowserLog: (log) => {
      if (log.type === "error") {
        errors.push(log.text);
        console.error(`Browser error: ${log.text}`);
      }
    },
  };
  try {
    await mkdir(options.outputDir, { recursive: true });
    // Bundle exactly once. A single reused Chromium, sequential stills (one
    // render at a time) stays below the swarm concurrency ceiling of two.
    const bundleStart = performance.now();
    const serveUrl = await bundle({ entryPoint: options.entryPoint,
      publicDir: join(videoDir, "public"), outDir: join(tempDir, "bundle") });
    const bundleSeconds = (performance.now() - bundleStart) / 1000;
    browser = await openBrowser("chrome", rendererOptions);
    const composition = await selectComposition({ ...rendererOptions, serveUrl,
      puppeteerInstance: browser, id: options.compositionId });
    if (composition.width !== FILM.width || composition.height !== FILM.height
      || composition.fps !== FILM.fps || composition.durationInFrames !== options.durationInFrames) {
      throw new Error("Unexpected composition dimensions, fps or frame count");
    }
    const renderStart = performance.now();
    for (const frame of options.frames) {
      const output = join(options.outputDir, stillFilename(frame));
      // Remove a stale file first: a failed render must not look successful.
      await rm(output, { force: true });
      await renderStill({ ...rendererOptions, composition, serveUrl, frame,
        puppeteerInstance: browser, imageFormat: "png", output, overwrite: true });
      const info = await stat(output);
      const signature = (await readFile(output)).subarray(0, 8);
      if (info.size === 0 || !signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error(`Missing or invalid PNG: ${output}`);
      }
      if (errors.length) throw new Error(`Browser reported ${errors.length} error(s)`);
      console.log(`PNG ${relative(productDir, output)} frame=${frame}`);
    }
    const renderSeconds = (performance.now() - renderStart) / 1000;
    console.log(`TIMING bundle=${bundleSeconds.toFixed(3)}s renders=${renderSeconds.toFixed(3)}s total=${((performance.now() - started) / 1000).toFixed(3)}s concurrency=1`);
    console.log(`STILLS ok count=${options.frames.length}`);
    return { count: options.frames.length, bundleSeconds, renderSeconds };
  } finally {
    try { if (browser) await browser.close({ silent: true }); }
    finally { await rm(tempDir, { recursive: true, force: true }); }
  }
}

if (import.meta.main) {
  try { await renderPreview(parseStillOptions(process.argv.slice(2))); }
  catch (error) {
    console.error(`STILLS error: ${error.message}`);
    process.exitCode = 1;
  }
}
