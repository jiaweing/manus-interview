import type { Buffer } from "node:buffer";

export interface SttInput {
  /** Activated recording only; in-memory WebM, never a path or remote URL. */
  audio: Uint8Array | Buffer;
  mimeType: string;
  phraseHints: string[];
  signal: AbortSignal;
}

/** Shared by cloud STT and the local whisper.cpp adapter (#254). */
export interface SttAdapter {
  transcribe: (input: SttInput) => Promise<string>;
}

export type SttErrorCode =
  | "invalid_input"
  | "key_unavailable"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "empty_transcript"
  | "aborted"
  | "deadline_exceeded";

/** Never wrap raw exceptions, abort reasons, response bodies, or request data. */
export class SttError extends Error {
  readonly code: SttErrorCode;
  readonly httpStatus: number | undefined;

  constructor(code: SttErrorCode, httpStatus?: number) {
    super(`STT failed: ${code}`);
    this.name = "SttError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
