import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOPSIDE_CARDS, FlopsideScene, FlopsideTable, getFlopsideState, SHOWDOWN_FRAME, WAGER_FRAME } from "../src/scenes/FlopsideScene.jsx";
import { getScenePresentation } from "../src/SceneFrame.jsx";
import { UI } from "../src/theme.js";
import { FIXTURES } from "../src/timeline.js";
import { stillFilename } from "../scripts/preview-stills.js";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDir = resolve(videoDir, "../..");
const sourcePath = join(videoDir, "src/scenes/FlopsideScene.jsx");
const table = (frame) => renderToStaticMarkup(React.createElement("svg", null, React.createElement(FlopsideTable, { frame })));
// Deliberately grep raw scene source too: prohibited text in comments is a failure.
const FORBIDDEN_FUNDS = /[$€£¥₹₽₩₿]|\b(?:money|currency|deposit\w*|withdraw\w*|cash\w*|pay\w*|purchase\w*|buy|wallet|credit|debit|bank|USD|EUR|GBP|BTC|ETH)\b/i;
const FORBIDDEN_RENDER = /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|setTimeout\s*\(|setInterval\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|new\s+Date\b|https?:\/\//;
const FORBIDDEN_UI = /stroke|border|outline|divider|<line\b|PALETTE\.(?:Sun|Mint)|#FFD166|#6DD6BC/i;

describe("Flopside illustration", () => {
  test("exports the assigned scene and uses SceneFrame without duplicated overlays", async () => {
    expect(typeof FlopsideScene).toBe("function");
    const source = await readFile(sourcePath, "utf8");
    expect(source).toContain('<SceneFrame sceneId="flopside">');
    expect(source).toContain("useCurrentFrame()");
    expect(source).not.toMatch(/<svg\b|CaptionPlate|LabelStack|from\s+["']\.\/.*Scene/);
  });

  test("source and every frame contain no funds, payment, remote or mutable-render cues", async () => {
    const source = await readFile(sourcePath, "utf8");
    expect(source).not.toMatch(FORBIDDEN_FUNDS);
    expect(source).not.toMatch(FORBIDDEN_RENDER);
    expect(source).not.toMatch(FORBIDDEN_UI);
    for (const sample of ["$20", "€20", "£20", "¥20", "₹20", "₿", "Deposit", "withdrawal", "cash-out", "Pay", "payments", "real-money", "Currency", "USD", "Wallet"])
      expect(FORBIDDEN_FUNDS.test(sample)).toBe(true);
    for (let frame = 0; frame < 240; frame++) {
      const markup = table(frame);
      expect(markup).not.toMatch(FORBIDDEN_FUNDS);
      expect(markup).not.toMatch(FORBIDDEN_UI);
      expect(markup).toContain("Free chips");
    }
  });

  test("two backed private hands exist until one simultaneous showdown at local 180", () => {
    expect(SHOWDOWN_FRAME).toBe(180);
    for (let frame = 0; frame < 240; frame++) {
      const state = getFlopsideState(frame);
      expect(state.seats.map(({ name }) => name)).toEqual(FIXTURES.flopside.seats);
      const markup = table(frame);
      expect(markup.match(/data-seat=/g)?.length).toBe(2);
      expect(markup.match(/data-shared-table="one"/g)?.length).toBe(1);
      if (frame < SHOWDOWN_FRAME) {
        expect(state.seats.every(({ cards }) => cards === null)).toBe(true);
        expect(markup.match(/data-card="private-back"/g)?.length).toBe(4);
        expect(markup.match(/data-ui-icon="card-back"/g)?.length).toBe(4);
        expect(markup.match(/data-card="face"/g)?.length).toBe(5); // public board only
        expect(markup).not.toContain('data-shared-result="one"');
        expect(state.result).toBeNull();
      } else {
        expect(state.seats.map(({ cards }) => cards)).toEqual(FLOPSIDE_CARDS.hands);
        expect(markup).not.toContain("private-back");
        expect(markup).not.toContain('data-ui-icon="card-back"');
        expect(markup.match(/data-card="face"/g)?.length).toBe(9);
        expect(markup.match(/data-shared-result="one"/g)?.length).toBe(1);
        expect(markup.match(/Player A wins/g)?.length).toBe(1);
        expect(markup).toContain("Shared showdown");
      }
    }
    expect(240 - SHOWDOWN_FRAME).toBeGreaterThanOrEqual(60);
  });

  test("play-chip placement begins exactly at local 120 and conserves the fixture chips", async () => {
    expect(WAGER_FRAME).toBe(120);
    expect(SHOWDOWN_FRAME).toBeGreaterThan(WAGER_FRAME);
    const source = await readFile(sourcePath, "utf8");
    expect(source).toContain("enter(frame, WAGER_FRAME, beat(1))");
    expect(source).toContain("frame >= WAGER_FRAME");
    for (let frame = 0; frame < 240; frame++) {
      const state = getFlopsideState(frame);
      const placed = frame >= 120;
      expect(state.wagerPlaced).toBe(placed);
      expect(state.wager).toBe(placed ? 20 : 0);
      expect(state.total).toBe(placed ? 40 : 0);
      expect(state.seats.reduce((sum, seat) => sum + seat.chips, state.total)).toBe(400);
      expect(table(frame).includes('data-wager="play-chips"')).toBe(placed);
    }
    expect(table(120)).toContain("40 play chips");
    expect(table(120)).toContain("20 each");
    expect(getFlopsideState(120).revealed).toBe(false);
  });

  test("card faces are filled monochrome glyphs with at least 48px text", () => {
    for (const frame of [0, 120, 180, 239]) {
      const markup = table(frame);
      for (const match of markup.matchAll(/(?:fill|flood-color)="(#[\dA-Fa-f]{6})"/g))
        expect(Object.values(UI)).toContain(match[1]);
      for (const match of markup.matchAll(/font-size="(\d+)"/g))
        expect(Number(match[1])).toBeGreaterThanOrEqual(48);
      expect(markup).toContain("<path");
      expect(markup).not.toMatch(/[♠♥♦♣🂠🃏]/); // suits use explicit monochrome paths
    }
  });

  test("caption/name and Illustrated UI/Concept stay present for all 240 frames", () => {
    for (let frame = 0; frame < 240; frame++) {
      const presentation = getScenePresentation("flopside", frame);
      expect(presentation.caption.text).toBe("Flopside — Friends.\nPoker. Free chips.");
      expect(presentation.labels).toEqual(["Illustrated UI", "Concept"]);
      expect(presentation.geometry.fontSize).toBeGreaterThanOrEqual(48);
      expect(presentation.caption.fromFrame).toBe(420);
      expect(presentation.caption.toFrame).toBe(660);
    }
    expect(getScenePresentation("flopside", 240).caption).toBeUndefined();
  });

  test("fixtures are immutable and repeated/shuffled frame markup is deterministic", () => {
    expect(Object.isFrozen(FLOPSIDE_CARDS)).toBe(true);
    expect(Object.isFrozen(FLOPSIDE_CARDS.hands[0][0])).toBe(true);
    for (const frame of [239, 0, 120, 179, 180, 30, 120, 0, 239]) {
      expect(getFlopsideState(frame)).toEqual(getFlopsideState(frame));
      expect(table(frame)).toBe(table(frame));
    }
  });

  test("real shared-preview smoke renders three native Flopside frames within 90s", async () => {
    const out = await mkdtemp(join(tmpdir(), "s7-flopside-smoke-"));
    const started = performance.now();
    const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3s", "85s", process.execPath,
      join(videoDir, "scripts/preview-stills.js"), "--scene", "flopside", "--frames", "450,540,630", "--out", out],
      { cwd: productDir, stdout: "pipe", stderr: "pipe" });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).not.toContain("STILLS error");
      expect(stdout).toContain("STILLS ok count=3");
      expect((await readdir(join(out, "flopside"))).sort()).toEqual([450, 540, 630].map(stillFilename));
      for (const frame of [450, 540, 630]) {
        const png = await readFile(join(out, "flopside", stillFilename(frame)));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(1920);
        expect(png.readUInt32BE(20)).toBe(1080);
        expect(png.length).toBeGreaterThan(50000);
      }
      console.log(`Flopside real still smoke: ${((performance.now() - started) / 1000).toFixed(3)}s\n${stdout.trim()}`);
    } finally {
      if (child.exitCode === null) { child.kill(); await child.exited; }
      await rm(out, { recursive: true, force: true });
    }
  }, 90000);
});
