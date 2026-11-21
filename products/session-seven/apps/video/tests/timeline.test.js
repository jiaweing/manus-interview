import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as timeline from "../src/timeline.js";
import { validateTimeline } from "../src/validate-timeline.js";

const { SCENES, FIXTURES, SEEDS, sceneStartFrame, sceneEndFrame, sceneAtFrame } = timeline;
const copy = () => ({ scenes: structuredClone(SCENES) });
const codes = (input) => validateTimeline(input).violations.map((violation) => violation.code);
const temp = mkdtempSync(join(tmpdir(), "session-seven-timeline-"));
const root = resolve(import.meta.dir, "../../..");
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const negatives = [
  ["missing product", "MISSING_PRODUCT", (input) => input.scenes.splice(1, 1)],
  ["one-frame gap", "GAP", (input) => {
    input.scenes[1].bars -= 1 / 60;
    input.scenes[1].captions[0].toFrame -= 1;
  }],
  ["caption outside interval", "CAPTION_OUT_OF_SCENE", (input) => { input.scenes[1].captions[0].toFrame = 421; }],
  ["prototype without evidence", "PROTOTYPE_WITHOUT_EVIDENCE", (input) => { input.scenes[1].status = "prototype"; }],
  ["duplicate product", "DUPLICATE_PRODUCT", (input) => { input.scenes[2].product = "Caret"; }],
  ["overlap", "OVERLAP", (input) => { input.scenes[1].startBar -= 1 / 60; }],
  ["wrong duration", "WRONG_DURATION", (input) => { input.scenes[7].bars = 2; }],
  ["over-long line", "CAPTION_LINE_LENGTH", (input) => { input.scenes[1].captions[0].text = "x".repeat(39); }],
  ["three lines", "CAPTION_LINES", (input) => { input.scenes[1].captions[0].text = "Caret\nSpeak.\nText at your caret."; }],
  ["bad status", "INVALID_STATUS", (input) => { input.scenes[1].status = "released"; }],
];

describe("locked timeline", () => {
  test("accepts the namespace and scenes-only JSON contract", () => {
    expect(validateTimeline(timeline)).toEqual({ ok: true, violations: [] });
    expect(validateTimeline(copy())).toEqual({ ok: true, violations: [] });
    expect(SCENES.map((scene) => [scene.id, sceneStartFrame(scene), sceneEndFrame(scene)])).toEqual([
      ["intro", 0, 180], ["caret", 180, 420], ["flopside", 420, 660],
      ["patchbay", 660, 900], ["sidekick", 900, 1140], ["tetherterm", 1140, 1380],
      ["glassroom", 1380, 1620], ["outro", 1620, 1800],
    ]);
  });

  test("owns fixed beat values, readiness labels and recursively frozen illustration data", () => {
    expect([timeline.BPM, timeline.BEATS_PER_BAR, timeline.FRAMES_PER_BEAT, timeline.FRAMES_PER_BAR, timeline.FPS, timeline.TOTAL_FRAMES]).toEqual([120, 4, 15, 60, 30, 1800]);
    expect(timeline.READINESS_LABEL).toEqual({ concept: "Concept", prototype: "Prototype" });
    expect(timeline.ILLUSTRATED_LABEL).toBe("Illustrated UI");
    expect(Object.keys(SEEDS)).toEqual(SCENES.map((scene) => scene.id));
    expect(Object.values(SEEDS).every(Number.isInteger)).toBe(true);
    expect(Object.keys(FIXTURES)).toEqual(SCENES.map((scene) => scene.id));
    expect(Object.isFrozen(SCENES)).toBe(true);
    for (const scene of SCENES) {
      expect(Object.isFrozen(scene)).toBe(true);
      expect(Object.isFrozen(scene.captions)).toBe(true);
      expect(Object.isFrozen(scene.captions[0])).toBe(true);
      expect(FIXTURES[scene.id].note).toMatch(/Fake, sanitized/);
    }
    expect(Object.isFrozen(FIXTURES.patchbay.transcriptLines)).toBe(true);
    expect(FIXTURES.patchbay.transcriptLines.at(-1)).toMatch(/pending; not executed/);
    expect(FIXTURES.sidekick.approvalText).toMatch(/not executed/);
    expect(FIXTURES.tetherterm.sessionId).toBe("demo-session-007");
    expect(FIXTURES.flopside.chipLabel).toBe("Play-money chips");
    expect(FIXTURES.glassroom.ciphertextLabel).toBe("Ciphertext illustration");
  });

  test("scene lookup respects every end-exclusive cut and rejects outside/noninteger frames", () => {
    for (const scene of SCENES) {
      expect(sceneAtFrame(sceneStartFrame(scene))).toBe(scene);
      expect(sceneAtFrame(sceneEndFrame(scene) - 1)).toBe(scene);
      expect(sceneAtFrame(sceneEndFrame(scene))).not.toBe(scene);
    }
    for (const frame of [-1, 1800, 9999, 0.5, NaN, Infinity]) expect(sceneAtFrame(frame)).toBeUndefined();
  });

  for (const [name, code, mutate] of negatives) {
    test(`rejects ${name} with ${code}`, () => {
      const input = copy();
      mutate(input);
      expect(validateTimeline(input).ok).toBe(false);
      expect(codes(input)).toContain(code);
    });
  }

  test("rejects each changed beat constant and total frame count", () => {
    for (const key of ["BPM", "BEATS_PER_BAR", "FRAMES_PER_BEAT", "FRAMES_PER_BAR", "FPS"]) {
      expect(codes({ ...copy(), [key]: timeline[key] + 1 })).toContain("WRONG_BEAT_VALUES");
    }
    expect(codes({ ...copy(), TOTAL_FRAMES: 1799 })).toContain("WRONG_DURATION");
  });

  test("rejects short key-text holds, missing PRDs, changed captions and framing status", () => {
    const short = copy();
    short.scenes[1].captions[0].toFrame = 239;
    expect(codes(short)).toContain("CAPTION_HOLD");
    const prd = copy();
    prd.scenes[1].prdRef = " ";
    expect(codes(prd)).toContain("MISSING_PRD_REF");
    const text = copy();
    text.scenes[0].captions[0].text = "Six released products.";
    expect(codes(text)).toContain("CAPTION_TEXT");
    expect(codes(text)).toContain("UNSUPPORTED_WORDING");
    for (const index of [0, 7]) {
      const framing = copy();
      framing.scenes[index].status = "concept";
      expect(codes(framing)).toContain("STATUS_ON_FRAMING_SCENE");
    }
  });

  test("requires purpose-specific truthful claims and concept qualification", () => {
    const caret = copy();
    caret.scenes[1].claim = "Exploring dictation everywhere.";
    expect(codes(caret)).toContain("UNSUPPORTED_WORDING");
    const flopside = copy();
    flopside.scenes[2].claim = "Exploring poker with chips.";
    expect(codes(flopside)).toContain("UNSUPPORTED_WORDING");
    const concept = copy();
    concept.scenes[1].claim = "Desktop dictation at the caret.";
    expect(codes(concept)).toContain("UNSUPPORTED_WORDING");
  });

  test("audits unsupported wording in both claims and captions", () => {
    for (const wording of ["live integration", "released", "launched", "shipping", "universal voice control", "anonymous", "untraceable", "endpoint protected", "real money", "cash", "deposit", "withdrawal", "approval-free"]) {
      for (const field of ["claim", "caption"]) {
        const input = copy();
        if (field === "claim") input.scenes[6].claim += ` ${wording}`;
        else input.scenes[6].captions[0].text += ` ${wording}`;
        expect(codes(input)).toContain("UNSUPPORTED_WORDING");
      }
    }
  });

  test("allows prototype only with a nonblank auditable reference, never out-of-scope promises", () => {
    const input = copy();
    input.scenes[1].status = "prototype";
    input.scenes[1].evidenceRef = "qa/caret-evidence.md#desktop-dictation";
    expect(validateTimeline(input).ok).toBe(true);
    input.scenes[1].claim += " Live integration.";
    expect(validateTimeline(input).ok).toBe(true);
    input.scenes[1].claim += " Universal voice control.";
    expect(codes(input)).toContain("UNSUPPORTED_WORDING");
    input.scenes[1].evidenceRef = " ";
    expect(codes(input)).toContain("PROTOTYPE_WITHOUT_EVIDENCE");
    expect(codes(input)).toContain("UNSUPPORTED_WORDING");
  });

  test("malformed records return named violations without throwing", () => {
    for (const input of [null, {}, { scenes: null }, { scenes: [null] }, { scenes: [{ id: "caret" }] }]) {
      expect(() => validateTimeline(input)).not.toThrow();
      expect(validateTimeline(input).ok).toBe(false);
    }
  });
});

function runCLI(args = []) {
  const command = [process.execPath, "run", "validate:timeline", ...args];
  const result = Bun.spawnSync(command, { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  console.log(`$ bun run validate:timeline${args.length ? ` ${args.join(" ")}` : ""}\n${stdout}${stderr}exitCode=${result.exitCode}`);
  return { ...result, stdout, stderr };
}

describe("real CLI verification with temporary fixtures", () => {
  test("default command prints the exact PASS line and exits zero", () => {
    const result = runCLI();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("PASS timeline: 6 products, 8 scenes, 1800 frames\n");
  });
  for (const [name, code, mutate] of negatives.slice(0, 4)) {
    test(`--file rejects ${name} with ${code} and exit 1`, () => {
      const input = copy();
      mutate(input);
      const path = join(temp, `${name.replaceAll(" ", "-")}.json`);
      writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
      const result = runCLI(["--file", path]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(`FAIL timeline: ${code} `);
    });
  }
  test("accepts a JavaScript fixture module and valid scenes-only JSON", () => {
    const json = join(temp, "valid.json");
    writeFileSync(json, `${JSON.stringify(copy())}\n`);
    expect(runCLI(["--file", json]).exitCode).toBe(0);
    const js = join(temp, "valid.js");
    writeFileSync(js, `export default ${JSON.stringify(copy())};\n`);
    expect(runCLI(["--file", js]).exitCode).toBe(0);
  });
  test("invalid input and arguments fail without a passing line", () => {
    const invalid = join(temp, "invalid.json");
    writeFileSync(invalid, "not JSON\n");
    for (const args of [["--unknown"], ["--file", invalid], ["--file", join(temp, "missing.json")]]) {
      const result = runCLI(args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/^FAIL timeline: INVALID_/);
      expect(result.stdout).not.toContain("PASS timeline:");
    }
  });
});
