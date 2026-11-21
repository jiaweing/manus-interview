import {
  BPM, BEATS_PER_BAR, FRAMES_PER_BEAT, FRAMES_PER_BAR, FPS, TOTAL_FRAMES,
  sceneStartFrame, sceneEndFrame,
} from "./timeline.js";

// Independent contract, not inferred from potentially malformed input records.
const LOCKED = [
  ["intro", null, 1, 3, "Six ideas. One build session."],
  ["caret", "Caret", 4, 4, "Caret — Speak.\nText at your caret."],
  ["flopside", "Flopside", 8, 4, "Flopside — Friends.\nPoker. Free chips."],
  ["patchbay", "Patchbay", 12, 4, "Patchbay — Local agents.\nInspectable plugins."],
  ["sidekick", "Sidekick", 16, 4, "Sidekick — Browser actions,\nsupervised."],
  ["tetherterm", "TetherTerm", 20, 4, "TetherTerm — One terminal.\nOngoing control."],
  ["glassroom", "Glassroom", 24, 4, "Glassroom — Two people.\nEncrypted text."],
  ["outro", null, 28, 3, "Built by Jia Wei Ng. What next?"],
];
const PRODUCTS = LOCKED.filter((entry) => entry[1]).map((entry) => entry[1]);
const BEAT_VALUES = { BPM, BEATS_PER_BAR, FRAMES_PER_BEAT, FRAMES_PER_BAR, FPS, TOTAL_FRAMES };

// A prototype plus a nonempty evidence reference permits an auditable operational
// claim, not an automatic assertion that the reference proves it. The claims
// audit must review that evidence. Absolute/out-of-scope promises remain denied.
const OPERATIONAL_WORDING = [
  /\blive[\s-]+(?:integration|extension|connection|terminal|demo(?:nstration)?|delivery|security)\b/i,
  /\b(?:released?|launched?|shipping|shipped|production[\s-]+ready)\b/i,
  /\b(?:operational|running)[\s-]+(?:server|agent|integration|encryption)\b/i,
  /\b(?:verified[\s-]+live[\s-]+security|encryption[\s-]+(?:verified|proven)|autonomous[\s-]+completion|approval[\s-]+free)\b/i,
];
const FORBIDDEN_WORDING = [
  /\b(?:universal[\s-]+voice[\s-]+control|voice[\s-]+commands?|controls?[\s-]+every[\s-]+app)\b/i,
  /\b(?:anonymous|anonymity|untraceable|endpoint[\s-]+protect(?:ed|ion)|absolute[\s-]+security)\b/i,
  /\b(?:real[\s-]+money|cash(?:[\s-]+out)?|deposits?|withdraw(?:al|als)?|purchases?|payments?|prizes?)\b/i,
];
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** Accept an ESM timeline namespace, or JSON {scenes:[...], optional beat constants}. */
export function validateTimeline(timeline) {
  const violations = [];
  const fail = (code, message) => violations.push({ code, message });
  if (!timeline || typeof timeline !== "object") {
    return { ok: false, violations: [{ code: "INVALID_TIMELINE", message: "Expected a timeline object." }] };
  }
  for (const [key, expected] of Object.entries(BEAT_VALUES)) {
    if (owns(timeline, key) && timeline[key] !== expected) {
      fail(key === "TOTAL_FRAMES" ? "WRONG_DURATION" : "WRONG_BEAT_VALUES", `${key} must equal ${expected}.`);
    }
  }
  const scenes = owns(timeline, "scenes") ? timeline.scenes : timeline.SCENES;
  if (!Array.isArray(scenes)) {
    fail("INVALID_TIMELINE", "Expected scenes to be an array.");
    return { ok: false, violations };
  }
  if (scenes.length !== 8) fail("WRONG_SCENE_COUNT", `Expected 8 scenes, received ${scenes.length}.`);
  const records = scenes.filter((scene) => scene && typeof scene === "object" && !Array.isArray(scene));
  for (const product of PRODUCTS) {
    const count = records.filter((scene) => scene.product === product).length;
    if (count === 0) fail("MISSING_PRODUCT", `Missing ${product}.`);
    if (count > 1) fail("DUPLICATE_PRODUCT", `${product} appears ${count} times.`);
  }
  for (const [id] of LOCKED) {
    const count = records.filter((scene) => scene.id === id).length;
    if (count === 0) fail("MISSING_SCENE", `Missing ${id}.`);
    if (count > 1) fail("DUPLICATE_SCENE", `${id} appears ${count} times.`);
  }

  let previousEnd = 0;
  let duration = 0;
  let validIntervals = true;
  scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      fail("INVALID_SCENE", `Scene ${index} must be a record.`);
      validIntervals = false;
      return;
    }
    const name = nonempty(scene.id) ? scene.id : `scene ${index}`;
    const locked = LOCKED.find((entry) => entry[0] === scene.id);
    if (!locked) fail("UNKNOWN_SCENE", `Unknown scene id ${name}.`);
    if (LOCKED[index]?.[0] !== scene.id) fail("WRONG_SCENE_ORDER", `${name} is not in the prescribed position ${index}.`);
    if (locked && scene.product !== locked[1]) fail("INVALID_PRODUCT", `${name} must have product ${locked[1] ?? "null"}.`);
    if (locked && (scene.startBar !== locked[2] || scene.bars !== locked[3])) {
      fail("WRONG_SCENE_INTERVAL", `${name} must start at bar ${locked[2]} and span ${locked[3]} bars.`);
    }
    if (!Number.isInteger(scene.startBar) || scene.startBar < 1 || !Number.isInteger(scene.bars) || scene.bars <= 0) {
      fail("WRONG_BEAT_VALUES", `${name} requires positive whole bars and a one-based startBar.`);
    }
    const start = sceneStartFrame(scene);
    const end = sceneEndFrame(scene);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      fail("WRONG_DURATION", `${name} has an invalid frame interval.`);
      validIntervals = false;
    } else {
      if (start > previousEnd) fail("GAP", `${name} starts at ${start}; previous end is ${previousEnd}.`);
      if (start < previousEnd) fail("OVERLAP", `${name} starts at ${start}; previous end is ${previousEnd}.`);
      if (locked && end - start !== locked[3] * FRAMES_PER_BAR) {
        fail("WRONG_DURATION", `${name} must span ${locked[3] * FRAMES_PER_BAR} frames.`);
      }
      duration += end - start;
      previousEnd = end;
    }

    const framing = scene.id === "intro" || scene.id === "outro";
    const evidence = nonempty(scene.evidenceRef);
    const supportedPrototype = scene.status === "prototype" && evidence;
    if (framing) {
      if (owns(scene, "status")) fail("STATUS_ON_FRAMING_SCENE", `${name} must omit status.`);
    } else {
      if (scene.status !== "concept" && scene.status !== "prototype") fail("INVALID_STATUS", `${name} status must be concept or prototype.`);
      if (scene.status === "prototype" && !evidence) fail("PROTOTYPE_WITHOUT_EVIDENCE", `${name} prototype requires a nonempty evidenceRef.`);
      if (scene.status === "concept" && !/^Exploring\b/.test(scene.claim ?? "")) {
        fail("UNSUPPORTED_WORDING", `${name} concept claim must begin with Exploring.`);
      }
    }
    if (!nonempty(scene.prdRef)) fail("MISSING_PRD_REF", `${name} requires a source PRD reference.`);
    if (!nonempty(scene.claim)) fail("UNSUPPORTED_WORDING", `${name} requires a nonempty claim.`);

    const captions = Array.isArray(scene.captions) ? scene.captions : [];
    if (captions.length !== 1) fail("WRONG_CAPTION_COUNT", `${name} requires one fixed caption.`);
    const texts = [scene.claim, ...captions.map((caption) => caption?.text)].filter((text) => typeof text === "string");
    for (const text of texts) {
      if (FORBIDDEN_WORDING.some((pattern) => pattern.test(text)) || (!supportedPrototype && OPERATIONAL_WORDING.some((pattern) => pattern.test(text)))) {
        fail("UNSUPPORTED_WORDING", `${name} contains a prohibited or unsupported claim: ${JSON.stringify(text)}.`);
      }
    }
    if (scene.product === "Caret" && !/\bdesktop dictation\b/i.test(scene.claim ?? "")) {
      fail("UNSUPPORTED_WORDING", "Caret claim must specify desktop dictation.");
    }
    if (scene.product === "Flopside" && !/\b(?:play[\s-]+money|free chips)\b/i.test(scene.claim ?? "")) {
      fail("UNSUPPORTED_WORDING", "Flopside claim must specify play-money or free chips.");
    }

    for (const caption of captions) {
      if (!caption || typeof caption.text !== "string") {
        fail("CAPTION_LINES", `${name} caption must contain text.`);
        continue;
      }
      const lines = caption.text.split("\n");
      if (lines.length > 2 || lines.some((line) => !line.trim())) fail("CAPTION_LINES", `${name} caption requires one or two nonempty lines.`);
      if (lines.some((line) => [...line].length > 38)) fail("CAPTION_LINE_LENGTH", `${name} caption exceeds 38 characters per line.`);
      if (locked && caption.text !== locked[4]) fail("CAPTION_TEXT", `${name} caption must use the exact table wording and locked line break.`);
      if (!Number.isInteger(caption.fromFrame) || !Number.isInteger(caption.toFrame) || caption.fromFrame < start || caption.toFrame > end || caption.fromFrame >= caption.toFrame) {
        fail("CAPTION_OUT_OF_SCENE", `${name} caption must stay inside [${start},${end}) with integer end-exclusive frames.`);
      }
      const hold = caption.toFrame - caption.fromFrame;
      if (!Number.isFinite(hold) || hold < 60) fail("CAPTION_HOLD", `${name} caption must hold for at least 60 frames.`);
      if (Number.isFinite(hold) && hold <= (end - start) / 2) fail("CAPTION_COVERAGE", `${name} fixed caption must cover most of its scene.`);
    }
  });
  if (!validIntervals || duration !== TOTAL_FRAMES || previousEnd !== TOTAL_FRAMES) {
    fail("WRONG_DURATION", `Timeline must continuously cover [0,${TOTAL_FRAMES}); summed duration=${duration}, final end=${previousEnd}.`);
  }
  return { ok: violations.length === 0, violations };
}
