export interface CleanupInput {
  /** The caller must abort this signal when cancelling or invalidating a session. */
  signal: AbortSignal;
  transcript: string;
}

export interface CleanupProvider {
  clean: (input: CleanupInput) => Promise<string>;
}

export type CleanupErrorCode =
  | "aborted"
  | "timeout"
  | "missing_key"
  | "credentials"
  | "http"
  | "network"
  | "invalid_json"
  | "invalid_response"
  | "empty_text"
  | "non_plain_text"
  | "changed_numbers";

/** Safe to display: never includes payloads, URLs, credentials, or upstream errors. */
export class CleanupError extends Error {
  readonly code: CleanupErrorCode;
  readonly status: number | undefined;

  constructor(code: CleanupErrorCode, status?: number) {
    super(`Cleanup failed: ${code}`);
    this.name = "CleanupError";
    this.code = code;
    this.status = status;
  }
}
