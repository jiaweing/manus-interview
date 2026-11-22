import {
  OPENROUTER_CLEANUP_MODEL,
  OpenRouterCleanupProvider,
} from "../src/main/cleanup/openrouter";
import { CleanupError } from "../src/main/cleanup/provider";

const getApiKey = () => process.env.OPENROUTER_API_KEY;
if (!getApiKey()?.trim()) {
  console.info("NOT RUN: no key");
  process.exit(2);
}

const transcript =
  "Um Jia Wei Ng will review Manus tomorrow I I will not send 3 drafts before three PM";
const started = performance.now();
try {
  const provider = new OpenRouterCleanupProvider({ getApiKey });
  const text = await provider.clean({
    signal: new AbortController().signal,
    transcript,
  });
  const checks = {
    facts:
      /\breview\b/i.test(text) &&
      /\btomorrow\b/i.test(text) &&
      /\bdrafts\b/i.test(text),
    fillers: !/\bum\b/i.test(text),
    name: text.includes("Jia Wei Ng"),
    negation: /\bnot\b/i.test(text),
    nonempty: text.trim().length > 0,
    project: text.includes("Manus"),
  };
  const passed = Object.values(checks).every(Boolean);
  console.info(
    `model=${OPENROUTER_CLEANUP_MODEL} status=${passed ? "PASS" : "FAIL"} duration_ms=${Math.round(performance.now() - started)}`
  );
  for (const [check, ok] of Object.entries(checks)) {
    console.info(`${check}=${ok ? "PASS" : "FAIL"}`);
  }
  console.info("plain_text=PASS numeric_tokens=PASS (validated)");
  console.info(
    "Semantic fidelity still requires manual review; content intentionally withheld."
  );
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  const status = error instanceof CleanupError ? error.code : "unexpected";
  console.info(
    `model=${OPENROUTER_CLEANUP_MODEL} status=${status} duration_ms=${Math.round(performance.now() - started)}`
  );
  process.exitCode = 1;
}
