import type { AudioSubmission, CaretStatus } from "../../shared/ipc-contract";
import type { OverlayState } from "../../shared/overlay-state";
import type { InsertOutcome, Target } from "../helper/protocol";
import type { ActiveSession } from "../ipc-boundary";
import type { SessionPhase } from "../tray-hotkey";

export const RECORDING_LIMIT_MS = 60_000;
export const TRANSCRIPTION_DEADLINE_MS = 15_000;
export const CLEANUP_DEADLINE_MS = 5000;

export interface StageContext {
  sessionId: string;
  signal: AbortSignal;
}
export type CaptureStopReason = "submit" | "discard";
export type CapturedAudio = Omit<AudioSubmission, "sessionId">;
export interface SessionPorts {
  clean: (context: StageContext, transcript: string) => Promise<string>;
  emitOverlay: (state: OverlayState) => void;
  emitStatus: (status: CaretStatus) => void;
  hideOverlay: () => void;
  insert: (
    context: StageContext,
    input: { target: Target; text: string }
  ) => Promise<InsertOutcome>;
  snapshot: (context: StageContext) => Promise<Target>;
  // Request only. Listening requires a separate, matching captureReady ack.
  startCapture: (context: StageContext) => void | Promise<void>;
  // Discard must release capture even when context.signal is already aborted.
  // Submit stops once; terminal discard is an additional idempotent release.
  stopCapture: (
    context: StageContext,
    reason: CaptureStopReason
  ) => void | Promise<void>;
  transcribe: (context: StageContext, audio: CapturedAudio) => Promise<string>;
}
export interface SessionClock {
  clearTimeout: (handle: unknown) => void;
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
}
export interface SessionOptions {
  clock?: SessionClock;
  createAbortController?: () => AbortController;
  // One machine per app lifetime. The monotonic suffix is never reused.
  idPrefix?: string;
  ports?: Partial<SessionPorts>;
}
export interface SessionMachine {
  activate: () => "started" | "stopped" | "busy";
  cancel: (sessionId?: string) => boolean;
  captureReady: (sessionId: string) => boolean;
  failCapture: (sessionId: string) => boolean;
  getActiveSession: () => ActiveSession | null;
  getSessionPhase: () => SessionPhase;
  getStatus: () => CaretStatus;
  submitAudio: (submission: AudioSubmission) => boolean;
}

type Stage = "snapshot" | "capture" | "transcribing" | "cleaning" | "inserting";
interface Session extends ActiveSession {
  captureContext?: StageContext;
  controller?: AbortController;
  deadline?: number;
  stage?: Stage;
  target?: Target;
  timer?: unknown;
}
const SYSTEM_CLOCK: SessionClock = {
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};
function disconnected(): never {
  // Bounded static error only; never forward adapter/provider diagnostics.
  throw new Error("Session stage not connected");
}
const NOT_CONNECTED: SessionPorts = {
  clean: disconnected,
  emitOverlay: () => {
    /* Headless default. */
  },
  emitStatus: () => {
    /* Headless default. */
  },
  hideOverlay: () => {
    /* Headless default. */
  },
  insert: disconnected,
  snapshot: disconnected,
  startCapture: disconnected,
  stopCapture: () => {
    /* No capture exists until issue #11 connects it. */
  },
  transcribe: disconnected,
};

/** No Electron, capture, provider or helper implementation. Never retries. */
export function createSessionMachine(
  options: SessionOptions = {}
): SessionMachine {
  const ports = { ...NOT_CONNECTED, ...options.ports };
  const clock = options.clock ?? SYSTEM_CLOCK;
  const createController =
    options.createAbortController ?? (() => new AbortController());
  const prefix = options.idPrefix ?? crypto.randomUUID();
  let sequence = 0;
  let active: Session | null = null;
  let status: CaretStatus = { sessionId: null, state: "idle" };
  let terminating = false;

  function clearTimer(session: Session): void {
    if (session.timer !== undefined) {
      clock.clearTimeout(session.timer);
      session.timer = undefined;
    }
    session.deadline = undefined;
  }
  function abort(controller?: AbortController): void {
    try {
      controller?.abort();
    } catch {
      // Teardown must continue even if an injected controller throws.
    }
  }
  function terminal(session: Session, state: "idle" | "done" | "error"): void {
    if (active !== session) {
      return;
    }
    // Invalidate BEFORE abort listeners, stop requests, or status observers run.
    terminating = true;
    active = null;
    status = { sessionId: null, state };
    clearTimer(session);
    const context = session.captureContext ?? {
      sessionId: session.id,
      signal: session.controller?.signal ?? AbortSignal.abort(),
    };
    const { controller } = session;
    session.controller = undefined;
    session.captureContext = undefined;
    session.stage = undefined;
    session.target = undefined;
    abort(controller);
    try {
      Promise.resolve(ports.stopCapture(context, "discard")).catch(() => {
        // Terminal release is requested once, never retried or logged.
      });
    } catch {
      // Still publish terminal status if the release request itself throws.
    }
    try {
      if (state === "idle") {
        ports.hideOverlay();
      } else {
        ports.emitOverlay(state === "done" ? "Done" : "Error");
      }
    } catch {
      // An unavailable window cannot resurrect a session.
    }
    try {
      ports.emitStatus({ ...status });
    } catch {
      // No sensitive exceptions cross the boundary.
    }
    terminating = false;
  }
  function transition(
    session: Session,
    state: ActiveSession["state"],
    overlay?: OverlayState
  ): boolean {
    if (active !== session) {
      return false;
    }
    session.state = state;
    status = { sessionId: session.id, state };
    try {
      if (overlay) {
        ports.emitOverlay(overlay);
      }
      // An observer may synchronously cancel; do not publish obsolete metadata.
      if (active === session) {
        ports.emitStatus({ ...status });
      }
    } catch {
      terminal(session, "error");
    }
    return active === session;
  }
  function current(
    session: Session,
    stage: Stage,
    controller: AbortController
  ): boolean {
    return (
      active === session &&
      session.stage === stage &&
      session.controller === controller &&
      !controller.signal.aborted
    );
  }
  function withinDeadline(session: Session): boolean {
    if (session.deadline !== undefined && clock.now() >= session.deadline) {
      terminal(session, "error");
      return false;
    }
    return true;
  }
  function run<T>(
    session: Session,
    stage: Stage,
    operation: (context: StageContext) => T | Promise<T>,
    complete: (value: T) => void,
    deadlineMs?: number
  ): void {
    if (active !== session) {
      return;
    }
    clearTimer(session);
    const { controller: previous } = session;
    session.controller = undefined;
    session.stage = stage;
    abort(previous);
    if (active !== session) {
      return;
    }
    try {
      const controller = createController();
      session.controller = controller;
      const context = { sessionId: session.id, signal: controller.signal };
      if (stage === "capture") {
        session.captureContext = context;
      }
      if (deadlineMs !== undefined) {
        session.deadline = clock.now() + deadlineMs;
        session.timer = clock.setTimeout(() => {
          if (current(session, stage, controller)) {
            terminal(session, "error");
          }
        }, deadlineMs);
      }
      // Invoke synchronously after Starting/next-stage status was emitted.
      Promise.resolve(operation(context)).then(
        (value) => {
          if (
            current(session, stage, controller) &&
            (deadlineMs === undefined || withinDeadline(session))
          ) {
            try {
              complete(value);
            } catch {
              terminal(session, "error");
            }
          }
        },
        () => {
          if (current(session, stage, controller)) {
            terminal(session, "error");
          }
        }
      );
    } catch {
      terminal(session, "error");
    }
  }
  function beginInsertion(session: Session, text: string): void {
    const { target } = session;
    if (!(target && transition(session, "inserting"))) {
      return;
    }
    run(
      session,
      "inserting",
      (context) => ports.insert(context, { target, text }),
      (outcome) => {
        terminal(session, outcome === "paste_requested" ? "done" : "error");
      }
    );
  }
  function beginCleanup(session: Session, transcript: string): void {
    if (!transition(session, "cleaning", "Cleaning")) {
      return;
    }
    run(
      session,
      "cleaning",
      (context) => ports.clean(context, transcript),
      (text) => beginInsertion(session, text),
      CLEANUP_DEADLINE_MS
    );
  }
  function stop(session: Session): boolean {
    if (active !== session || session.state !== "listening") {
      return false;
    }
    clearTimer(session);
    if (!transition(session, "capture-complete", "Transcribing")) {
      return false;
    }
    try {
      const context = session.captureContext;
      if (!context) {
        terminal(session, "error");
        return false;
      }
      Promise.resolve(ports.stopCapture(context, "submit")).catch(() => {
        if (active === session) {
          terminal(session, "error");
        }
      });
    } catch {
      terminal(session, "error");
    }
    return true;
  }
  function activate(): "started" | "stopped" | "busy" {
    if (terminating) {
      return "busy";
    }
    if (active) {
      if (active.state === "listening") {
        stop(active);
        return "stopped";
      }
      return "busy";
    }
    sequence += 1;
    const session: Session = {
      id: `${prefix}_${sequence}`,
      state: "starting",
    };
    active = session;
    if (transition(session, "starting", "Starting")) {
      run(session, "snapshot", ports.snapshot, (target) => {
        // Snapshot belongs only to this session; renderer never receives handles.
        session.target = { ...target };
        run(session, "capture", ports.startCapture, () => {
          // Request completion is NOT the capture-ready acknowledgment.
        });
      });
    }
    return "started";
  }
  return {
    activate,
    cancel(sessionId) {
      if (!active || (sessionId !== undefined && active.id !== sessionId)) {
        return false;
      }
      terminal(active, "idle");
      return true;
    },
    captureReady(sessionId) {
      const session = active;
      if (
        !session ||
        session.id !== sessionId ||
        session.state !== "starting" ||
        session.stage !== "capture"
      ) {
        return false;
      }
      session.deadline = clock.now() + RECORDING_LIMIT_MS;
      session.timer = clock.setTimeout(() => stop(session), RECORDING_LIMIT_MS);
      return transition(session, "listening", "Listening");
    },
    failCapture(sessionId) {
      if (
        !active ||
        active.id !== sessionId ||
        !(
          active.state === "starting" ||
          active.state === "listening" ||
          active.state === "capture-complete"
        )
      ) {
        return false;
      }
      terminal(active, "error");
      return true;
    },
    getActiveSession: () =>
      active ? { id: active.id, state: active.state } : null,
    getSessionPhase: () => {
      if (!active) {
        return "idle";
      }
      return active.state === "listening" ? "recording" : "busy";
    },
    getStatus: () => ({ ...status }),
    submitAudio(submission) {
      const session = active;
      if (
        !session ||
        session.id !== submission.sessionId ||
        session.state !== "capture-complete"
      ) {
        return false;
      }
      if (!transition(session, "transcribing", "Transcribing")) {
        return false;
      }
      run(
        session,
        "transcribing",
        (context) =>
          ports.transcribe(context, {
            audio: submission.audio,
            mimeType: submission.mimeType,
          }),
        (transcript) => beginCleanup(session, transcript),
        TRANSCRIPTION_DEADLINE_MS
      );
      return true;
    },
  };
}
