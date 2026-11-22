import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createOpenRouterSttAdapter,
  OPENROUTER_STT_MODEL,
} from "../src/main/stt/openrouter";
import { SttError } from "../src/main/stt/types";

const reportPath = resolve(
  import.meta.dir,
  "../../../evidence/stt/smoke-report.json"
);

function report(status: string, durationMs: number): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  const metadata = { durationMs, modelId: OPENROUTER_STT_MODEL, status };
  writeFileSync(reportPath, `${JSON.stringify(metadata, null, 2)}\n`);
  // This is the complete output allowlist: no key, path, audio, hints or transcript.
  console.info(JSON.stringify(metadata));
}

async function smoke(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    report("NOT RUN: no key", 0);
    process.exitCode = 2;
    return;
  }
  const start = performance.now();
  try {
    // Fixed synthetic speech, not a live recording. Never persist the request/response.
    const audio = readFileSync(
      resolve(import.meta.dir, "fixtures/stt-smoke.webm")
    );
    const adapter = createOpenRouterSttAdapter({
      getApiKey: () => process.env.OPENROUTER_API_KEY,
    });
    await adapter.transcribe({
      audio,
      mimeType: "audio/webm;codecs=opus",
      phraseHints: ["Caret"],
      signal: new AbortController().signal,
    });
    report("HTTP success", Math.round(performance.now() - start));
  } catch (error) {
    const status =
      error instanceof SttError
        ? `${error.httpStatus === undefined ? "FAILED" : `HTTP ${error.httpStatus} failure`}: ${error.code}`
        : "FAILED: fixture unavailable";
    report(status, Math.round(performance.now() - start));
    process.exitCode = 1;
  }
}

await smoke();
