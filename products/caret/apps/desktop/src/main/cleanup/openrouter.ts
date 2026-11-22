import { CLEANUP_POLICY, CLEANUP_TEXT_SCHEMA } from "./policy";
import {
  CleanupError,
  type CleanupInput,
  type CleanupProvider,
} from "./provider";
import { isRecord, validateCleanupOutput } from "./validate";

// Public catalog verified 2026-11-21; live smoke NOT RUN without an authorized key.
export const OPENROUTER_CLEANUP_MODEL = "openai/gpt-4o-mini-2024-07-18";
export const CLEANUP_DEADLINE_MS = 5000;
const TRAILING_SLASH = /\/$/;

export interface OpenRouterCleanupOptions {
  /** API root, not a complete endpoint. Injectable for local HTTP fixture servers. */
  baseUrl?: string;
  getApiKey: () => string | undefined;
}

function responseText(value: unknown): string {
  if (
    !isRecord(value) ||
    value.status !== "completed" ||
    (value.error !== null && value.error !== undefined) ||
    (value.incomplete_details !== null &&
      value.incomplete_details !== undefined) ||
    !Array.isArray(value.output) ||
    value.output.length !== 1
  ) {
    throw new CleanupError("invalid_response");
  }
  const message: unknown = value.output[0];
  if (
    !isRecord(message) ||
    message.type !== "message" ||
    message.role !== "assistant" ||
    message.status !== "completed" ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  ) {
    throw new CleanupError("invalid_response");
  }
  const part: unknown = message.content[0];
  if (
    !isRecord(part) ||
    part.type !== "output_text" ||
    typeof part.text !== "string"
  ) {
    throw new CleanupError("invalid_response");
  }
  return part.text;
}

export class OpenRouterCleanupProvider implements CleanupProvider {
  private readonly options: OpenRouterCleanupOptions;

  constructor(options: OpenRouterCleanupOptions) {
    this.options = options;
  }

  async clean({ transcript, signal }: CleanupInput): Promise<string> {
    if (signal.aborted) {
      throw new CleanupError("aborted");
    }
    const started = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLEANUP_DEADLINE_MS);
    const checkActive = () => {
      if (signal.aborted) {
        throw new CleanupError("aborted");
      }
      if (timedOut || performance.now() - started >= CLEANUP_DEADLINE_MS) {
        throw new CleanupError("timeout");
      }
    };
    try {
      let apiKey: string | undefined;
      try {
        apiKey = this.options.getApiKey();
      } catch {
        // biome-ignore lint/style/useErrorCause: Credential errors must not retain secret-bearing causes.
        throw new CleanupError("credentials");
      }
      checkActive();
      if (!apiKey?.trim()) {
        throw new CleanupError("missing_key");
      }
      const baseUrl = this.options.baseUrl ?? "https://openrouter.ai/api/v1";
      const response = await fetch(
        `${baseUrl.replace(TRAILING_SLASH, "")}/responses`,
        {
          body: JSON.stringify({
            input: transcript,
            instructions: CLEANUP_POLICY,
            model: OPENROUTER_CLEANUP_MODEL,
            provider: { allow_fallbacks: false, require_parameters: true },
            store: false,
            stream: false,
            temperature: 0,
            text: {
              format: {
                name: "cleaned_dictation",
                schema: CLEANUP_TEXT_SCHEMA,
                strict: true,
                type: "json_schema",
              },
            },
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        }
      );
      checkActive();
      if (!response.ok) {
        await response.body?.cancel();
        throw new CleanupError("http", response.status);
      }
      let payload: unknown;
      // Abort/body-stream failures remain network/abort/timeout errors, not JSON errors.
      const body = await response.text();
      checkActive();
      try {
        payload = JSON.parse(body);
      } catch {
        // biome-ignore lint/style/useErrorCause: Parse errors may quote dictation; keep no cause.
        throw new CleanupError("invalid_json");
      }
      const text = validateCleanupOutput(responseText(payload), transcript);
      checkActive();
      return text;
    } catch (error) {
      checkActive();
      if (error instanceof CleanupError) {
        throw error;
      }
      // Do not retain upstream messages/causes: they may echo secrets or dictation.
      // biome-ignore lint/style/useErrorCause: Raw fetch errors are not safe to retain.
      throw new CleanupError("network");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
