// All ranges are absolute, zero-based, and end-exclusive. PRD bars are one-based.
export const BPM = 120;
export const BEATS_PER_BAR = 4;
export const FRAMES_PER_BEAT = 15;
export const FRAMES_PER_BAR = 60;
export const FPS = 30;
export const TOTAL_FRAMES = 1800;

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const SEEDS = freeze({
  intro: 7001,
  caret: 7002,
  flopside: 7003,
  patchbay: 7004,
  sidekick: 7005,
  tetherterm: 7006,
  glassroom: 7007,
  outro: 7008,
});

// Invented, non-sensitive text only. These are illustrations, never recordings,
// real credentials, operational transcripts, or cryptographic test vectors.
export const FIXTURES = freeze({
  intro: { note: "Fake, sanitized framing tiles" },
  caret: {
    note: "Fake, sanitized desktop dictation; insertion only, never submission",
    shortcut: "Ctrl+Alt+Space",
    dictationText: "The sample draft is ready for review.",
    insertedText: "The sample draft is ready for review.",
  },
  flopside: {
    note: "Fake, sanitized poker illustration; free play-money chips only",
    chipLabel: "Play-money chips",
    seats: ["Player A", "Player B"],
    startingChips: 200,
    wagerChips: 20,
    potChips: 40,
    showdownText: "Shared showdown: Player A wins",
  },
  patchbay: {
    note: "Fake, sanitized CLI transcript; no command or pending write is executed",
    transcriptLines: [
      "$ patchbay plugin inspect workspace-scout",
      "Plugin: workspace-scout (illustrated)",
      "Capability: read-only workspace search",
      "Result: sample.txt:3 — review sample draft",
      "Illustrated write request: sample-note.txt",
      "Awaiting write approval — pending; not executed",
    ],
    approvalText: "Awaiting write approval",
  },
  sidekick: {
    note: "Fake, sanitized browser task; no live extension or submission",
    pageTitle: "Sample article",
    planText: "Plan: find the sample heading, then prepare a draft.",
    actionText: "Illustrated action: scroll to the sample heading.",
    approvalText: "Awaiting approval — submission not executed",
  },
  tetherterm: {
    note: "Fake, sanitized terminal transcript; one illustrative session, no live PTY",
    sessionId: "demo-session-007",
    transcriptLines: [
      "Session: demo-session-007 (illustrated)",
      ">>> sample = 6",
      ">>> sample * 7",
      "42",
      ">>> sample + 1",
      "7",
    ],
    inputText: ">>> sample + 1",
    outputText: "7",
  },
  glassroom: {
    note: "Fake, sanitized paired text; ciphertext is a drawing, not encryption proof",
    participants: ["Person A", "Person B"],
    plaintext: "Hello from the sample room.",
    ciphertext: "[illustrative ciphertext: 7A 2C 90 B1]",
    ciphertextLabel: "Ciphertext illustration",
  },
  outro: { note: "Fake, sanitized independent framing tiles" },
});

export const READINESS_LABEL = freeze({ concept: "Concept", prototype: "Prototype" });
export const ILLUSTRATED_LABEL = "Illustrated UI";

export const SCENES = freeze([
  {
    id: "intro", product: null, startBar: 1, bars: 3,
    claim: "Six ideas. One build session.",
    prdRef: "docs/prds/07-promo-video.md#11-success-metrics-and-a-demo-script",
    evidenceRef: null,
    captions: [{ fromFrame: 0, toFrame: 180, text: "Six ideas. One build session." }],
  },
  {
    id: "caret", product: "Caret", startBar: 4, bars: 4, status: "concept",
    claim: "Exploring desktop dictation: spoken words become text at the caret, without submission.",
    prdRef: "docs/prds/01-desktop-voice-input.md#6-functional-requirements",
    evidenceRef: null,
    captions: [{ fromFrame: 180, toFrame: 420, text: "Caret — Speak.\nText at your caret." }],
  },
  {
    id: "flopside", product: "Flopside", startBar: 8, bars: 4, status: "concept",
    claim: "Exploring multiplayer poker with free play-money chips, private cards and a shared showdown.",
    prdRef: "docs/prds/02-multiplayer-web-game.md#5-core-user-flows-step-by-step-include-edge-cases",
    evidenceRef: null,
    captions: [{ fromFrame: 420, toFrame: 660, text: "Flopside — Friends.\nPoker. Free chips." }],
  },
  {
    id: "patchbay", product: "Patchbay", startBar: 12, bars: 4, status: "concept",
    claim: "Exploring local CLI agents and inspectable plugins; an illustrated write request stays pending approval.",
    prdRef: "docs/prds/03-local-agent-harness.md#5-core-user-flows",
    evidenceRef: null,
    captions: [{ fromFrame: 660, toFrame: 900, text: "Patchbay — Local agents.\nInspectable plugins." }],
  },
  {
    id: "sidekick", product: "Sidekick", startBar: 16, bars: 4, status: "concept",
    claim: "Exploring supervised browser actions: a visible plan, an illustrated action and an approval pause.",
    prdRef: "docs/prds/04-chrome-agent-sidepanel.md#6-functional-requirements-prioritized-p0p1p2-each-with-id",
    evidenceRef: null,
    captions: [{ fromFrame: 900, toFrame: 1140, text: "Sidekick — Browser actions,\nsupervised." }],
  },
  {
    id: "tetherterm", product: "TetherTerm", startBar: 20, bars: 4, status: "concept",
    claim: "Exploring ongoing terminal control: illustrated input and output retain the same session and history.",
    prdRef: "docs/prds/05-mcp-terminal-controller.md#5-core-user-flows-step-by-step-include-edge-cases",
    evidenceRef: null,
    captions: [{ fromFrame: 1140, toFrame: 1380, text: "TetherTerm — One terminal.\nOngoing control." }],
  },
  {
    id: "glassroom", product: "Glassroom", startBar: 24, bars: 4, status: "concept",
    claim: "Exploring two-person encrypted text through paired messages and an illustrative ciphertext drawing.",
    prdRef: "docs/prds/06-p2p-encrypted-chat.md#10-risks-open-questions-and-mitigations",
    evidenceRef: null,
    captions: [{ fromFrame: 1380, toFrame: 1620, text: "Glassroom — Two people.\nEncrypted text." }],
  },
  {
    id: "outro", product: null, startBar: 28, bars: 3,
    claim: "Built by Jia Wei Ng. What next?",
    prdRef: "docs/prds/07-promo-video.md#11-success-metrics-and-a-demo-script",
    evidenceRef: null,
    captions: [{ fromFrame: 1620, toFrame: 1800, text: "Built by Jia Wei Ng. What next?" }],
  },
]);

export function sceneStartFrame(scene) {
  return (scene.startBar - 1) * FRAMES_PER_BAR;
}

export function sceneEndFrame(scene) {
  return sceneStartFrame(scene) + scene.bars * FRAMES_PER_BAR;
}

export function sceneAtFrame(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= TOTAL_FRAMES) return undefined;
  return SCENES.find((scene) => frame >= sceneStartFrame(scene) && frame < sceneEndFrame(scene));
}
