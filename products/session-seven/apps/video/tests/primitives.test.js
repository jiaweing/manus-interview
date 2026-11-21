import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { beat, bar, enter, hold, seeded, translateIn } from "../src/anim.js";
import { PALETTE, UI, SAFE, FONT_SIZES, FONT_FAMILY, RADIUS, TEXT_PAIRS, contrastRatio } from "../src/theme.js";
import { FONT_FILES, FONT_WEIGHTS, fontFaceCss } from "../src/fonts.js";
import { Backdrop, backdropShapes, Group, SoftShadow } from "../src/layers.jsx";
import { Pip, PIP_BODY, PIP_POSES } from "../src/Pip.jsx";
import { Button, Caret, Cli, Cursor, Icon, ICON_NAMES, Panel, Row, TextLine, Window } from "../src/ui.jsx";
import { CaptionPlate, LabelStack, SCENE_LAYOUT, captionGeometry, getScenePresentation } from "../src/SceneFrame.jsx";
import { SCENE_COMPONENTS } from "../src/scenes/index.js";
import { READINESS_LABEL, SCENES, sceneStartFrame, sceneEndFrame } from "../src/timeline.js";
import { parseStillOptions, PRIMITIVES_FRAMES, stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const source = (name) => readFile(join(videoDir, "src", name), "utf8");
const svg = (...children) => renderToStaticMarkup(React.createElement("svg", null, ...children));
const node = React.createElement;
const FORBIDDEN_UI = /stroke|border|outline|<line\b|divider|boxShadow\s*:\s*[^\n]*ring/i;
const FORBIDDEN_RENDER = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|new\s+Date\b/;
const assertSafe = (rect) => {
  expect(rect.x).toBeGreaterThanOrEqual(SAFE.x);
  expect(rect.y).toBeGreaterThanOrEqual(SAFE.y);
  expect(rect.right).toBeLessThanOrEqual(SAFE.right);
  expect(rect.bottom).toBeLessThanOrEqual(SAFE.bottom);
};

const allUi = () => svg(
  node(Window, null, node(TextLine, { text: "Key" }), node(TextLine, { text: "Secondary", tone: "secondary" })),
  node(Panel, null, node(TextLine, { text: "Panel" })), node(Row, null),
  node(Cli, { lines: ["Inspect", "Pending"] }), node(Cli, { light: true, lines: ["Read only"] }),
  node(Button, { label: "Approve" }), node(Button, { variant: "secondary", label: "Pause" }),
  node(Caret, null), node(Cursor, { dark: true }),
  ...ICON_NAMES.map((name) => node(Icon, { name })), ...ICON_NAMES.map((name) => node(Icon, { name, dark: true })),
);

describe("shared visual vocabulary", () => {
  test("exact immutable exterior and monochrome palettes", () => {
    expect(PALETTE).toEqual({ Paper: "#FFF7E8", Ink: "#20212B", Sun: "#FFD166", Mint: "#6DD6BC" });
    expect(new Set(Object.values(UI))).toEqual(new Set(["#FAFAFA", "#F4F4F5", "#18181B", "#71717A", "#FFFFFF"]));
    expect(Object.isFrozen(UI)).toBe(true);
    expect(RADIUS).toBe(10);
    const colors = [...allUi().matchAll(/(?:fill|flood-color)="(#[\dA-Fa-f]{6})"/g)].map((match) => match[1]);
    expect(colors.length).toBeGreaterThan(20);
    for (const color of colors) expect(Object.values(UI)).toContain(color);
  });
  test("every declared text/background pair passes AA", () => {
    for (const pair of TEXT_PAIRS) expect(contrastRatio(pair.text, pair.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI.muted, UI.card)).toBeCloseTo(4.6302515748, 8);
    expect(contrastRatio(UI.muted, UI.panel)).toBeLessThan(4.5);
    expect(contrastRatio(UI.muted, UI.ink)).toBeLessThan(4.5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio(UI.ink, UI.card)).toBe(contrastRatio(UI.card, UI.ink));
    expect(() => contrastRatio("red", UI.card)).toThrow();
  });
  test("interface source and rendered markup contain zero prohibited line styles", async () => {
    for (const name of ["ui.jsx", "SceneFrame.jsx"]) expect(await source(name)).not.toMatch(FORBIDDEN_UI);
    expect(allUi()).not.toMatch(FORBIDDEN_UI);
    for (const forbidden of ["border: 0", "outline: none", "strokeWidth={0}", "<line x1={0}", "divider", "boxShadow: ring"]) {
      expect(FORBIDDEN_UI.test(forbidden)).toBe(true); // guard test actually catches violations
    }
  });
  test("accent references appear only in exterior/scenery modules", async () => {
    for (const name of ["ui.jsx", "SceneFrame.jsx", "Hero.jsx", "fonts.js", "FontLoader.jsx"]) {
      expect(await source(name)).not.toMatch(/PALETTE\.(?:Sun|Mint)|#FFD166|#6DD6BC/i);
    }
    // Scenes/gallery are exterior drawing modules too: later builders may use
    // accents there, but never as children/fills of a monochrome UI surface.
    expect(await source("layers.jsx")).toMatch(/PALETTE\.Sun/);
    expect(await source("Pip.jsx")).toMatch(/PALETTE\.Mint/);
  });
  test("filled monochrome glyphs and fixed caret blocks", () => {
    expect(ICON_NAMES).toEqual(["mic", "keyboard", "lock", "card-back", "chip", "globe", "browser", "terminal-prompt", "check", "hourglass", "pause"]);
    for (const name of ICON_NAMES) {
      const markup = svg(node(Icon, { name }));
      expect(markup).toContain("<path");
      expect(markup).toContain('fill-rule="evenodd"');
      expect(markup).not.toMatch(FORBIDDEN_UI);
    }
    expect(() => svg(node(Icon, { name: "unknown" }))).toThrow();
    expect(Cursor).toBe(Caret);
  });
  test("Inter 400/600/700 are bundled locally and block first paint", async () => {
    expect(FONT_WEIGHTS).toEqual([400, 600, 700]);
    for (const file of FONT_FILES) expect((await readFile(join(videoDir, "public", file))).length).toBeGreaterThan(10000);
    expect(fontFaceCss().match(/@font-face/g)?.length).toBe(3);
    expect(fontFaceCss()).not.toMatch(/https?:\/\//);
    const loader = await source("FontLoader.jsx");
    expect(loader).toContain("delayRender");
    expect(loader).toContain("continueRender");
    expect(loader).toContain("document.fonts.load");
    expect(await source("SceneFrame.jsx")).toContain("<FontLoader />");
    expect(FONT_FAMILY).toContain("Session Inter");
  });
});

describe("safe, fixed captions and truthful readiness labels", () => {
  test("caption, label and illustration rectangles obey the 5% safe area", () => {
    expect(SAFE).toEqual({ x: 96, y: 54, width: 1728, height: 972, right: 1824, bottom: 1026 });
    for (const rect of [SCENE_LAYOUT.caption, SCENE_LAYOUT.label, SCENE_LAYOUT.readiness, SCENE_LAYOUT.illustration]) assertSafe(rect);
    expect(SCENE_LAYOUT.readiness.bottom).toBeLessThan(SCENE_LAYOUT.illustration.y);
    expect(SCENE_LAYOUT.illustration.bottom).toBeLessThan(SCENE_LAYOUT.caption.y);
    for (const scene of SCENES) for (const caption of scene.captions) {
      const geometry = captionGeometry(caption.text);
      assertSafe(geometry.plate);
      assertSafe(geometry.text);
      expect(geometry.lines.length).toBeLessThanOrEqual(2);
      expect(geometry.fontSize).toBe(60);
      expect(geometry.lines.every((line) => line.length <= 38)).toBe(true);
    }
    expect(() => captionGeometry("one\ntwo\nthree")).toThrow();
  });
  test("caption/label/reading text cannot fall below 48px", () => {
    expect(FONT_SIZES.caption).toBe(60);
    expect(FONT_SIZES.label).toBeGreaterThanOrEqual(48);
    expect(FONT_SIZES.ui).toBeGreaterThanOrEqual(48);
    const markup = svg(node(TextLine, { text: "Read me", fontSize: 16 }), node(Button, { label: "Read" }),
      node(CaptionPlate, { text: "Safe caption" }), node(LabelStack, { labels: ["Illustrated UI", "Prototype"] }));
    for (const match of markup.matchAll(/font-size="(\d+)"/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(48);
    expect(markup).not.toMatch(FORBIDDEN_UI);
  });
  test("Concept and Prototype render distinct literal text", () => {
    const concept = svg(node(LabelStack, { labels: ["Illustrated UI", READINESS_LABEL.concept] }));
    const prototype = svg(node(LabelStack, { labels: ["Illustrated UI", READINESS_LABEL.prototype] }));
    expect(concept).toContain(">Concept</text>");
    expect(prototype).toContain(">Prototype</text>");
    expect(concept).not.toEqual(prototype);
  });
  test("all eight independent scenes use SceneFrame and the correct timeline record", async () => {
    expect(Object.keys(SCENE_COMPONENTS)).toEqual(SCENES.map((scene) => scene.id));
    for (const scene of SCENES) {
      const component = SCENE_COMPONENTS[scene.id];
      expect(typeof component).toBe("function");
      const code = await source(`scenes/${component.name}.jsx`);
      expect(code).toContain(`<SceneFrame sceneId="${scene.id}">`);
      expect(code).toContain("useCurrentFrame()");
      expect(code).not.toMatch(/from\s+["']\.\/.*Scene/);
      const duration = sceneEndFrame(scene) - sceneStartFrame(scene);
      for (let frame = 0; frame < duration; frame++) {
        const view = getScenePresentation(scene.id, frame);
        expect(view.caption.text).toBe(scene.captions[0].text);
        expect(view.labels).toEqual(scene.product ? ["Illustrated UI", READINESS_LABEL[scene.status]] : []);
      }
      expect(duration).toBeGreaterThanOrEqual(60);
      if (scene.product) expect(scene.captions[0].text).toContain(scene.product);
    }
  });
  test("caption absolute endpoints become end-exclusive local endpoints", () => {
    for (const scene of SCENES) {
      const duration = sceneEndFrame(scene) - sceneStartFrame(scene);
      expect(getScenePresentation(scene.id, -1).caption).toBeUndefined();
      expect(getScenePresentation(scene.id, 0).caption).toBeDefined();
      expect(getScenePresentation(scene.id, duration - 1).caption).toBeDefined();
      expect(getScenePresentation(scene.id, duration).caption).toBeUndefined();
    }
    expect(() => getScenePresentation("missing", 0)).toThrow();
  });
  test("Hero contains only timeline Sequences and gallery is opt-in", async () => {
    const hero = await source("Hero.jsx");
    expect(hero).toContain("<Sequence");
    expect(hero).toContain("sceneStartFrame(scene)");
    expect(hero).toContain("sceneEndFrame(scene) - sceneStartFrame(scene)");
    expect(hero).not.toMatch(/Audio|AbsoluteFill|benchmark|gallery/);
    const root = await source("Root.jsx");
    expect(root.match(/<Composition\b/g)?.length).toBe(1);
    expect(root).not.toMatch(/Gallery|Benchmark/);
  });
});

describe("static mascot and bounded frame-only motion", () => {
  test("single primary capsule plus one offset copy, six static poses, unique shadow ids", async () => {
    expect(PIP_BODY).toEqual({ width: 200, height: 300, rx: 100 });
    expect(Object.keys(PIP_POSES)).toEqual(["neutral", "happy", "listening", "thinking", "pointing", "waving"]);
    for (const pose of Object.keys(PIP_POSES)) {
      const markup = svg(node(Pip, { pose, x: 10, y: 20, scale: 1.2 }));
      expect(markup.match(/data-pip-body="capsule"/g)?.length).toBe(1);
      expect(markup.match(/<rect[^>]*rx="100"/g)?.length).toBe(2);
      expect(markup).toContain('data-layer="offset-silhouette"');
      expect(markup).toContain("feDropShadow");
      expect(markup).toContain("translate(10 20) scale(1.2)");
      expect(markup).toEqual(svg(node(Pip, { pose, x: 10, y: 20, scale: 1.2 })));
    }
    const multiple = svg(node(Pip), node(Pip), node(SoftShadow, null, node("rect", { width: 20, height: 20 })));
    const ids = [...multiple.matchAll(/<filter id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect(await source("Pip.jsx")).not.toMatch(/rotate|useCurrentFrame|interpolate|useEffect|useState/);
    expect(() => svg(node(Pip, { pose: "unknown" }))).toThrow();
  });
  test("beat grid, easing, holds and entrances clamp deterministically", () => {
    expect(beat(4)).toBe(60);
    expect(bar(4)).toBe(240);
    expect(enter(-1, 0, 30)).toBe(0);
    expect(enter(15, 0, 30)).toBe(0.5);
    expect(enter(31, 0, 30)).toBe(1);
    expect(enter(0, 0, 0)).toBe(1);
    expect(hold(10, 10, 60)).toBe(true);
    expect(hold(69, 10, 60)).toBe(true);
    expect(hold(70, 10, 60)).toBe(false);
    const options = Object.freeze({ fromX: 90, fromY: 30, toX: 10, toY: 0 });
    for (const frame of [0, 15, 30, 1799, 15, 0]) {
      expect(enter(frame, 0, 30)).toBe(enter(frame, 0, 30));
      expect(translateIn(frame, 0, 30, options)).toEqual(translateIn(frame, 0, 30, options));
    }
    expect(translateIn(30, 0, 30, options)).toEqual({ x: 10, y: 0 });
    expect(translateIn(1799, 0, 30, options)).toEqual({ x: 10, y: 0 });
    expect(svg(node(Group, { x: 10, y: 20 }, node("rect", { width: 30, height: 40 })))).toContain("translate(10 20)");
  });
  test("Mulberry32 and seeded scenery regenerate identically for shuffled frames", () => {
    const a = seeded(7001), b = seeded(7001), c = seeded(7002);
    const valuesA = Array.from({ length: 20 }, a), valuesB = Array.from({ length: 20 }, b), valuesC = Array.from({ length: 20 }, c);
    expect(valuesA).toEqual(valuesB);
    expect(valuesA).not.toEqual(valuesC);
    expect(valuesA[0]).toBeCloseTo(0.964236170751974, 12);
    expect(valuesA.every((value) => value >= 0 && value < 1)).toBe(true);
    const shapes = backdropShapes(7001);
    for (const ignoredFrame of [239, 0, 150, 30]) expect(backdropShapes(7001)).toEqual(shapes);
    expect(Object.isFrozen(shapes)).toBe(true);
    expect(svg(node(Backdrop, { seed: 7001 }))).toEqual(svg(node(Backdrop, { seed: 7001 })));
  });
  test("all render sources exclude wall clocks, unseeded randomness, timers, remote assets and benchmark imports", async () => {
    const files = ["anim.js", "theme.js", "fonts.js", "FontLoader.jsx", "Pip.jsx", "layers.jsx", "ui.jsx", "SceneFrame.jsx", "Hero.jsx", "Root.jsx"];
    for (const dir of ["scenes", "gallery"]) files.push(...(await readdir(join(videoDir, "src", dir))).map((name) => `${dir}/${name}`));
    for (const file of files) {
      const code = await source(file);
      expect(code).not.toMatch(FORBIDDEN_RENDER);
      expect(code).not.toMatch(/https?:\/\/|from\s+["'][^"']*(?:benchmark|music)/);
    }
    for (const bad of ["Date.now()", "Math.random()", "setTimeout(() => {})", "setInterval(() => {})", "fetch(url)", "new XMLHttpRequest()", "new Date()"])
      expect(FORBIDDEN_RENDER.test(bad)).toBe(true);
  });
});

describe("shared still CLI", () => {
  test("strict frame parsing, output names and gallery routing", () => {
    const hero = parseStillOptions(["--frames", "0,30,150,1799"]);
    expect(hero.frames).toEqual([0, 30, 150, 1799]);
    expect(hero.outputDir).toBe(join(productDir, "qa/stills"));
    expect(hero.compositionId).toBe("Hero");
    expect(stillFilename(210)).toBe("frame-0210.png");
    const scoped = parseStillOptions(["--frames", "180,210,419", "--scene", "caret", "--out", "qa/example"]);
    expect(scoped.outputDir).toBe(join(productDir, "qa/example/caret"));
    const gallery = parseStillOptions(["--group", "primitives"]);
    expect(gallery.frames).toEqual(PRIMITIVES_FRAMES);
    expect(gallery.outputDir).toBe(join(productDir, "qa/stills/primitives"));
    expect(gallery.compositionId).toBe("PrimitivesGallery");
    expect(parseStillOptions(["--group", "primitives", "--frames", "0,239"]).frames).toEqual([0, 239]);
  });
  test("rejects malformed, missing, duplicate, out-of-scene and out-of-range selections before bundling", () => {
    for (const args of [[], ["--scene", "caret"], ["--frames"], ["--frames", ""], ["--frames", "-1"],
      ["--frames", "1800"], ["--frames", "1.5"], ["--frames", "1e2"], ["--frames", "0,"], ["--frames", "0, 30"],
      ["--frames", "0,0"], ["--frames", "0", "--frames", "1"], ["--unknown", "0"], ["--group", "missing"],
      ["--group", "primitives", "--frames", "240"], ["--group", "primitives", "--scene", "caret", "--frames", "210"],
      ["--frames", "179", "--scene", "caret"], ["--frames", "420", "--scene", "caret"], ["--frames", "210", "--scene", "missing"]]) {
      expect(() => parseStillOptions(args)).toThrow();
    }
  });
  test("real pinned-Chromium Hero smoke renders three native PNG frames within 90s", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-primitives-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath, join(videoDir, "scripts/preview-stills.js"),
      "--frames", "0,210,1799", "--out", out], { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      for (const frame of [0, 210, 1799]) {
        const png = await readFile(join(out, stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
