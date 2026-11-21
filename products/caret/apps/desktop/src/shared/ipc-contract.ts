export const IPC_REQUEST_CHANNEL = "caret:request";
export const IPC_STATUS_CHANNEL = "caret:status";
export const MAX_AUDIO_BYTES = 10_000_000;
export const WEBM_MIME_TYPES = [
  "audio/webm",
  "audio/webm;codecs=opus",
] as const;

export type SessionState =
  | "starting"
  | "listening"
  | "capture-complete"
  | "transcribing"
  | "cleaning"
  | "done"
  | "error";

// Status is deliberately metadata-only: no secrets, text, targets, or audio.
export interface CaretStatus {
  sessionId: string | null;
  state: "idle" | SessionState;
}

export interface AudioSubmission {
  audio: ArrayBuffer;
  mimeType: (typeof WEBM_MIME_TYPES)[number];
  sessionId: string;
}

export type BoundaryError =
  | "invalid_sender"
  | "unknown_operation"
  | "invalid_payload"
  | "invalid_session"
  | "invalid_state"
  | "invalid_mime"
  | "invalid_size"
  | "unavailable"
  | "operation_failed";

export type BoundaryResult =
  | { ok: true; status?: CaretStatus }
  | { ok: false; error: BoundaryError };

export interface CaretApi {
  cancel(sessionId: string): Promise<BoundaryResult>;
  setupKey(key: string): Promise<BoundaryResult>;
  submitAudio(submission: AudioSubmission): Promise<BoundaryResult>;
  subscribeStatus(listener: (status: CaretStatus) => void): () => void;
}

export type BoundaryRequest =
  | { operation: "setupKey"; payload: { key: string } }
  | { operation: "subscribeStatus"; payload: Record<string, never> }
  | { operation: "cancel"; payload: { sessionId: string } }
  | { operation: "submitAudio"; payload: AudioSubmission };
