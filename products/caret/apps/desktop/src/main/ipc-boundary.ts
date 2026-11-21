import {
  type AudioSubmission,
  type BoundaryError,
  type BoundaryResult,
  type CaretStatus,
  MAX_AUDIO_BYTES,
  type SessionState,
  WEBM_MIME_TYPES,
} from "../shared/ipc-contract";

export interface ActiveSession {
  id: string;
  state: SessionState;
}

export interface SenderContext {
  sender: unknown;
  senderFrame: { url: string } | null;
}

export interface BoundaryServices {
  cancel?: (sessionId: string) => void | Promise<void>;
  // These getters and callbacks belong to main, never to the renderer.
  getActiveSession: () => ActiveSession | null;
  getStatus: () => CaretStatus;
  setupKey?: (key: string) => void | Promise<void>;
  submitAudio?: (submission: AudioSubmission) => void | Promise<void>;
}

export interface TrustedRenderer {
  mainFrame: { url: string };
  sender: unknown;
  url: string;
}

function reject(error: BoundaryError): BoundaryResult {
  return { error, ok: false };
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function sessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function isBundledUrl(candidate: string, trustedUrl: string): boolean {
  try {
    const url = new URL(candidate);
    url.hash = "";
    return url.protocol === "file:" && url.href === trustedUrl;
  } catch {
    return false;
  }
}

export function isTrustedSender(
  event: SenderContext,
  trusted: TrustedRenderer
): boolean {
  return (
    event.sender === trusted.sender &&
    event.senderFrame !== null &&
    event.senderFrame === trusted.mainFrame &&
    isBundledUrl(event.senderFrame.url, trusted.url)
  );
}

// Copy only the public metadata even if a future session service has extra fields.
export function publicStatus(status: CaretStatus): CaretStatus {
  return { sessionId: status.sessionId, state: status.state };
}

function validateSetupKey(
  payload: Record<string, unknown>
): BoundaryError | null {
  if (
    !exactKeys(payload, ["key"]) ||
    typeof payload.key !== "string" ||
    payload.key.length > 4096 ||
    payload.key.trim().length === 0
  ) {
    return "invalid_payload";
  }
  return null;
}

function validateCancel(
  payload: Record<string, unknown>,
  services: BoundaryServices
): BoundaryError | null {
  if (!(exactKeys(payload, ["sessionId"]) && sessionId(payload.sessionId))) {
    return "invalid_payload";
  }
  if (services.getActiveSession()?.id !== payload.sessionId) {
    return "invalid_session";
  }
  return null;
}

function validateAudio(
  payload: Record<string, unknown>,
  services: BoundaryServices
): BoundaryError | null {
  if (
    !(
      exactKeys(payload, ["sessionId", "mimeType", "audio"]) &&
      sessionId(payload.sessionId)
    ) ||
    typeof payload.mimeType !== "string" ||
    !(payload.audio instanceof ArrayBuffer)
  ) {
    return "invalid_payload";
  }
  const active = services.getActiveSession();
  if (!active || active.id !== payload.sessionId) {
    return "invalid_session";
  }
  if (active.state !== "capture-complete") {
    return "invalid_state";
  }
  if (!WEBM_MIME_TYPES.some((mime) => mime === payload.mimeType)) {
    return "invalid_mime";
  }
  if (
    payload.audio.byteLength === 0 ||
    payload.audio.byteLength > MAX_AUDIO_BYTES
  ) {
    return "invalid_size";
  }
  return null;
}

function validateOperation(
  operation: unknown,
  payload: Record<string, unknown>,
  services: BoundaryServices
): BoundaryError | null {
  switch (operation) {
    case "setupKey":
      return (
        validateSetupKey(payload) ?? (services.setupKey ? null : "unavailable")
      );
    case "subscribeStatus":
      return exactKeys(payload, []) ? null : "invalid_payload";
    case "cancel":
      return (
        validateCancel(payload, services) ??
        (services.cancel ? null : "unavailable")
      );
    case "submitAudio":
      return (
        validateAudio(payload, services) ??
        (services.submitAudio ? null : "unavailable")
      );
    default:
      return "unknown_operation";
  }
}

export function createIpcBoundary(
  trusted: () => TrustedRenderer,
  services: BoundaryServices
): (event: SenderContext, request: unknown) => Promise<BoundaryResult> {
  return async (event, request) => {
    if (!isTrustedSender(event, trusted())) {
      return reject("invalid_sender");
    }
    if (!(record(request) && exactKeys(request, ["operation", "payload"]))) {
      return reject("invalid_payload");
    }
    const { operation, payload } = request;
    if (
      !["setupKey", "subscribeStatus", "cancel", "submitAudio"].includes(
        operation as string
      )
    ) {
      return reject("unknown_operation");
    }
    if (!record(payload)) {
      return reject("invalid_payload");
    }

    // No await occurs between validation and handing off to a main-owned callback.
    try {
      const error = validateOperation(operation, payload, services);
      if (error) {
        return reject(error);
      }
      // The synchronous validator checked availability; retain the services receiver.
      switch (operation) {
        case "setupKey":
          await (
            services.setupKey as NonNullable<BoundaryServices["setupKey"]>
          )(payload.key as string);
          return { ok: true };
        case "subscribeStatus":
          return { ok: true, status: publicStatus(services.getStatus()) };
        case "cancel":
          await (services.cancel as NonNullable<BoundaryServices["cancel"]>)(
            payload.sessionId as string
          );
          return { ok: true };
        case "submitAudio":
          await (
            services.submitAudio as NonNullable<BoundaryServices["submitAudio"]>
          )(payload as unknown as AudioSubmission);
          return { ok: true };
        default:
          return reject("unknown_operation");
      }
    } catch {
      // Never echo provider errors, payloads, or keys across IPC or into logs.
      return reject("operation_failed");
    }
  };
}
