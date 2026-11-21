// Capture the Remotion Studio showing the Hero composition (issue #151 verification) into qa/studio-bootstrap.png.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const productDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const url = process.env.STUDIO_URL || "http://localhost:3100";
const out = process.argv[2] || join(productDir, "qa/studio-bootstrap.png");
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${url}/Hero`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const text = await page.evaluate(() => document.body.innerText);
console.log(JSON.stringify({ hasHero: /Hero/.test(text), has1920x1080: /1920x1080/.test(text), has30fps: /30\s*fps/i.test(text), has1800: /1800/.test(text) }));
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
