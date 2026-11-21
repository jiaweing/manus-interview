import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import * as lockedTimeline from "../src/timeline.js";
import { validateTimeline } from "../src/validate-timeline.js";

async function main() {
  const args = process.argv.slice(2);
  let timeline = lockedTimeline;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--file") {
      console.log("FAIL timeline: INVALID_ARGUMENTS Expected --file <path.json|.js>.");
      return 1;
    }
    const path = resolve(args[1]);
    try {
      if (extname(path) === ".json") {
        timeline = JSON.parse(await readFile(path, "utf8"));
        if (!timeline || !Array.isArray(timeline.scenes)) throw new Error("JSON must contain {scenes:[...]}.");
      } else if (extname(path) === ".js") {
        const loaded = await import(pathToFileURL(path).href);
        timeline = loaded.default ?? loaded;
      } else {
        throw new Error("Fixture extension must be .json or .js.");
      }
    } catch (error) {
      console.log(`FAIL timeline: INVALID_FILE ${error.message}`);
      return 1;
    }
  }
  const result = validateTimeline(timeline);
  if (result.ok) {
    console.log("PASS timeline: 6 products, 8 scenes, 1800 frames");
    return 0;
  }
  for (const { code, message } of result.violations) console.log(`FAIL timeline: ${code} ${message}`);
  return 1;
}

process.exitCode = await main();
