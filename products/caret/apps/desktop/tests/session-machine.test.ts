import { describe, expect, test } from "bun:test";
import type { InsertOutcome, Target } from "../src/main/helper/protocol";
import { createIpcBoundary } from "../src/main/ipc-boundary";
import {
  sessionBoundaryServices,
  sessionTrayCallbacks,
} from "../src/main/session/bindings";
import {
  CLEANUP_DEADLINE_MS,
  createSessionMachine,
  RECORDING_LIMIT_MS,
  type SessionClock,
  type SessionPorts,
  type StageContext,
  TRANSCRIPTION_DEADLINE_MS,
} from "../src/main/session/machine";
import type { AudioSubmission, CaretStatus } from "../src/shared/ipc-contract";
import type { OverlayState } from "../src/shared/overlay-state";

const TARGET: Target = { focus: "0x12", foreground: "0x34" };
const AUDIO = { audio: new ArrayBuffer(8), mimeType: "audio/webm" as const };

class FakeClock implements SessionClock {
  private time = 0;
  private sequence = 0;
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();
  now = () => this.time;
  setTimeout = (callback: () => void, delayMs: number) => {
    this.sequence += 1;
    const id = this.sequence;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  advance(ms: number): void {
    const end = this.time + ms;
    while (this.timers.size > 0) {
      const [due] = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due) {
        break;
      }
      this.time = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.time = end;
  }
  // A settled response may run before an overdue timer task. Deadline still wins.
  elapseWithoutTimers(ms: number): void {
    this.time += ms;
  }
  pending(): number {
    return this.timers.size;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}
function request<T>(context: StageContext) {
  return { context, ...deferred<T>() };
}
function flush(remaining = 8): Promise<void> {
  // Include adapter settlement plus machine callbacks without real-clock sleeps.
  if (remaining === 0) {
    return Promise.resolve();
  }
  return Promise.resolve().then(() => flush(remaining - 1));
}
function fixture(overrides: Partial<SessionPorts> = {}) {
  const clock = new FakeClock();
  const overlay: OverlayState[] = [];
  const statuses: CaretStatus[] = [];
  const events: string[] = [];
  const snapshots: ReturnType<typeof request<Target>>[] = [];
  const captures: StageContext[] = [];
  const stops: { context: StageContext; reason: "submit" | "discard" }[] = [];
  const transcriptions: (ReturnType<typeof request<string>> & {
    audio: AudioSubmission["audio"];
  })[] = [];
  const cleanups: (ReturnType<typeof request<string>> & {
    transcript: string;
  })[] = [];
  const insertions: (ReturnType<typeof request<InsertOutcome>> & {
    target: Target;
    text: string;
  })[] = [];
  const inserted: string[] = [];
  const controllers: AbortController[] = [];
  let hides = 0;
  const machine = createSessionMachine({
    clock,
    createAbortController: () => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller;
    },
    idPrefix: "fixture",
    ports: {
      clean: (context, transcript) => {
        const item = { ...request<string>(context), transcript };
        cleanups.push(item);
        return item.promise;
      },
      emitOverlay: (state) => {
        events.push(state);
        overlay.push(state);
      },
      emitStatus: (status) => statuses.push(status),
      hideOverlay: () => {
        hides += 1;
      },
      insert: (context, input) => {
        const item = { ...request<InsertOutcome>(context), ...input };
        insertions.push(item);
        return item.promise.then((outcome) => {
          // Future insertion adapters MUST honor signal at the side-effect guard.
          if (!context.signal.aborted && outcome === "paste_requested") {
            inserted.push(input.text);
          }
          return outcome;
        });
      },
      snapshot: (context) => {
        events.push("snapshot");
        const item = request<Target>(context);
        snapshots.push(item);
        return item.promise;
      },
      startCapture: (context) => {
        events.push("startCapture");
        captures.push(context);
      },
      stopCapture: (context, reason) => {
        stops.push({ context, reason });
      },
      transcribe: (context, input) => {
        const item = { ...request<string>(context), audio: input.audio };
        transcriptions.push(item);
        return item.promise;
      },
      ...overrides,
    },
  });
  const start = () => {
    expect(machine.activate()).toBe("started");
    const id = machine.getActiveSession()?.id;
    expect(id).toBeDefined();
    return id as string;
  };
  const listen = async () => {
    const id = start();
    snapshots.at(-1)?.resolve(TARGET);
    await flush();
    expect(machine.captureReady(id)).toBe(true);
    return id;
  };
  const transcribe = async () => {
    const id = await listen();
    expect(machine.activate()).toBe("stopped");
    expect(machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(true);
    return id;
  };
  const clean = async () => {
    const id = await transcribe();
    transcriptions.at(-1)?.resolve("fixture transcript");
    await flush();
    return id;
  };
  const insert = async () => {
    const id = await clean();
    cleanups.at(-1)?.resolve("Fixture text.");
    await flush();
    return id;
  };
  return {
    captures,
    clean,
    cleanups,
    clock,
    controllers,
    events,
    hides: () => hides,
    insert,
    inserted,
    insertions,
    listen,
    machine,
    overlay,
    snapshots,
    start,
    statuses,
    stops,
    transcribe,
    transcriptions,
  };
}
type Fixture = ReturnType<typeof fixture>;
type Checkpoint =
  | "snapshot"
  | "starting"
  | "listening"
  | "capture-complete"
  | "transcribing"
  | "cleaning"
  | "inserting";
async function reach(f: Fixture, checkpoint: Checkpoint): Promise<string> {
  switch (checkpoint) {
    case "snapshot":
      return f.start();
    case "starting": {
      const id = f.start();
      f.snapshots[0].resolve(TARGET);
      await flush();
      return id;
    }
    case "listening":
      return f.listen();
    case "capture-complete": {
      const id = await f.listen();
      f.machine.activate();
      return id;
    }
    case "transcribing":
      return f.transcribe();
    case "cleaning":
      return f.clean();
    case "inserting":
      return f.insert();
    default:
      throw new Error("Unknown fixture checkpoint");
  }
}
function resolveAll(f: Fixture): void {
  for (const item of f.snapshots) {
    item.resolve(TARGET);
  }
  for (const item of f.transcriptions) {
    item.resolve("late transcript");
  }
  for (const item of f.cleanups) {
    item.resolve("Late text.");
  }
  for (const item of f.insertions) {
    item.resolve("paste_requested");
  }
}
function counts(f: Fixture): number[] {
  return [
    f.snapshots.length,
    f.captures.length,
    f.transcriptions.length,
    f.cleanups.length,
    f.insertions.length,
  ];
}
function expectTerminal(f: Fixture, state: "idle" | "error" | "done"): void {
  expect(f.machine.getStatus()).toEqual({ sessionId: null, state });
  expect(f.machine.getActiveSession()).toBeNull();
  expect(f.machine.getSessionPhase()).toBe("idle");
  expect(f.stops.at(-1)?.reason).toBe("discard");
  expect(f.controllers.every((controller) => controller.signal.aborted)).toBe(
    true
  );
  expect(f.clock.pending()).toBe(0);
}

// Linux fake adapters only. No microphone, hotkey, focus, clipboard or Windows evidence.
describe("bounded session machine", () => {
  test("Starting is immediate, before asynchronous work, and status is metadata only", () => {
    const f = fixture();
    const id = f.start();
    expect(f.events).toEqual(["Starting", "snapshot"]);
    expect(f.machine.getStatus()).toEqual({ sessionId: id, state: "starting" });
    expect(f.statuses).toEqual([{ sessionId: id, state: "starting" }]);
    expect(f.machine.getSessionPhase()).toBe("busy");
    f.machine.cancel();
  });

  test("Listening requires the matching capture-ready ack, not snapshot or request completion", async () => {
    const f = fixture();
    const id = f.start();
    expect(f.machine.captureReady(id)).toBe(false);
    expect(f.machine.captureReady("old")).toBe(false);
    f.snapshots[0].resolve(TARGET);
    await flush();
    expect(f.overlay).toEqual(["Starting"]);
    expect(f.machine.captureReady("old")).toBe(false);
    expect(f.machine.captureReady(id)).toBe(true);
    expect(f.machine.captureReady(id)).toBe(false);
    expect(f.overlay).toEqual(["Starting", "Listening"]);
    expect(f.machine.getSessionPhase()).toBe("recording");
    f.machine.cancel();
  });

  test("second Listening press requests one stop and audio cannot advance before it", async () => {
    const f = fixture();
    const id = await f.listen();
    expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(false);
    expect(f.machine.activate()).toBe("stopped");
    expect(f.machine.activate()).toBe("busy");
    expect(f.stops.map((stop) => stop.reason)).toEqual(["submit"]);
    expect(f.machine.getActiveSession()?.state).toBe("capture-complete");
    expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(true);
    expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(false);
    expect(f.transcriptions).toHaveLength(1);
    f.machine.cancel();
  });

  test("60-second cap starts at capture-ready, stops exactly once at the boundary", async () => {
    const f = fixture();
    const id = f.start();
    f.clock.advance(9000);
    f.snapshots[0].resolve(TARGET);
    await flush();
    f.machine.captureReady(id);
    f.clock.advance(RECORDING_LIMIT_MS - 1);
    expect(f.stops).toHaveLength(0);
    expect(f.machine.getStatus().state).toBe("listening");
    f.clock.advance(1);
    expect(f.stops.map((stop) => stop.reason)).toEqual(["submit"]);
    expect(f.machine.getStatus().state).toBe("capture-complete");
    expect(f.machine.activate()).toBe("busy");
    f.clock.advance(RECORDING_LIMIT_MS);
    expect(f.stops).toHaveLength(1);
    f.machine.cancel();
    expect(f.insertions).toHaveLength(0);
  });

  for (const checkpoint of [
    "snapshot",
    "starting",
    "capture-complete",
    "transcribing",
    "cleaning",
    "inserting",
  ] as const) {
    test(`busy presses in ${checkpoint} cannot spawn sessions or requests`, async () => {
      const f = fixture();
      const id = await reach(f, checkpoint);
      const before = counts(f);
      expect(f.machine.activate()).toBe("busy");
      expect(f.machine.activate()).toBe("busy");
      expect(f.machine.getActiveSession()?.id).toBe(id);
      expect(counts(f)).toEqual(before);
      f.machine.cancel();
    });
  }

  for (const checkpoint of [
    "snapshot",
    "starting",
    "listening",
    "capture-complete",
    "transcribing",
    "cleaning",
    "inserting",
  ] as const) {
    test(`Cancel during ${checkpoint}: abort, capture shutdown, stale callbacks, no retry or later insertion`, async () => {
      const f = fixture();
      const id = await reach(f, checkpoint);
      const before = counts(f);
      expect(f.machine.cancel(id)).toBe(true);
      expectTerminal(f, "idle");
      expect(f.hides()).toBe(1);
      expect(f.machine.captureReady(id)).toBe(false);
      expect(f.machine.failCapture(id)).toBe(false);
      expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(false);
      resolveAll(f);
      f.clock.advance(120_000);
      await flush();
      expectTerminal(f, "idle");
      expect(counts(f)).toEqual(before); // No provider retries or subsequent insert request.
      expect(f.inserted).toHaveLength(0);
      // Inserting already dispatched one attempt; cancellation cannot recall
      // external input, but aborts its port and forbids all subsequent advancement.
      expect(f.insertions.length).toBe(checkpoint === "inserting" ? 1 : 0);
      const fresh = f.start();
      expect(fresh).not.toBe(id);
      expect(f.machine.cancel(id)).toBe(false);
      f.machine.cancel();
    });
  }

  test("double Cancel and Cancel while idle are idempotent; terminal observer cannot reenter activation", async () => {
    const f = fixture();
    expect(f.machine.cancel()).toBe(false);
    await f.listen();
    expect(f.machine.cancel()).toBe(true);
    expect(f.machine.cancel()).toBe(false);
    expect(f.stops).toHaveLength(1);
    expect(f.hides()).toBe(1);
    let activation: string | undefined;
    const reentrant = fixture({
      stopCapture: () => {
        activation = reentrant.machine.activate();
      },
    });
    reentrant.start();
    reentrant.machine.cancel();
    expect(activation).toBe("busy");
    expect(reentrant.snapshots).toHaveLength(1);
  });

  for (const order of [
    "stop-first",
    "cancel-first",
    "cap-first",
    "cancel-before-cap",
  ] as const) {
    test(`stop + Cancel race (${order}) releases capture with zero insertion/retry`, async () => {
      const f = fixture();
      const id = await f.listen();
      if (order === "stop-first") {
        f.machine.activate();
        f.machine.cancel();
      } else if (order === "cancel-first") {
        f.machine.cancel();
        expect(f.machine.captureReady(id)).toBe(false);
      } else if (order === "cap-first") {
        f.clock.advance(RECORDING_LIMIT_MS);
        f.machine.cancel();
      } else {
        f.clock.advance(RECORDING_LIMIT_MS - 1);
        f.machine.cancel();
        f.clock.advance(1);
      }
      expectTerminal(f, "idle");
      expect(f.stops.filter((stop) => stop.reason === "submit").length).toBe(
        order === "stop-first" || order === "cap-first" ? 1 : 0
      );
      expect(f.stops.filter((stop) => stop.reason === "discard")).toHaveLength(
        1
      );
      expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(false);
      expect(f.insertions).toHaveLength(0);
      expect(f.transcriptions).toHaveLength(0);
      expect(f.cleanups).toHaveLength(0);
    });
  }

  for (const stage of ["transcribing", "cleaning"] as const) {
    const limit =
      stage === "transcribing"
        ? TRANSCRIPTION_DEADLINE_MS
        : CLEANUP_DEADLINE_MS;
    for (const delayedTimer of [false, true]) {
      test(`${stage} deadline exactly ${limit} ms${delayedTimer ? " before timer dispatch" : " with timer dispatch"}: Error, shutdown, no retry/insert`, async () => {
        const f = fixture();
        const id = await reach(f, stage);
        const before = counts(f);
        f.clock.advance(limit - 1);
        expect(f.machine.getStatus().state).toBe(stage);
        if (delayedTimer) {
          f.clock.elapseWithoutTimers(1);
          (stage === "transcribing"
            ? f.transcriptions[0]
            : f.cleanups[0]
          ).resolve("boundary response");
          await flush();
        } else {
          f.clock.advance(1);
        }
        expectTerminal(f, "error");
        expect(f.overlay.at(-1)).toBe("Error");
        resolveAll(f);
        await flush();
        f.clock.advance(120_000);
        expect(counts(f)).toEqual(before);
        expect(f.insertions).toHaveLength(0);
        expect(f.inserted).toHaveLength(0);
        expect(f.start()).not.toBe(id);
        f.machine.cancel();
      });
    }
    test(`${stage} response one millisecond before deadline advances and clears old timer`, async () => {
      const f = fixture();
      await reach(f, stage);
      f.clock.advance(limit - 1);
      (stage === "transcribing" ? f.transcriptions[0] : f.cleanups[0]).resolve(
        "in time"
      );
      await flush();
      f.clock.advance(1);
      expect(f.machine.getStatus().state).toBe(
        stage === "transcribing" ? "cleaning" : "inserting"
      );
      f.machine.cancel();
    });
  }

  test("successful hook chain owns the initial snapshot, aborts each stage, inserts once and invalidates on Done", async () => {
    const f = fixture();
    const id = await f.insert();
    expect(f.insertions[0].target).toEqual(TARGET);
    expect(f.insertions[0].text).toBe("Fixture text.");
    expect(f.controllers).toHaveLength(5);
    expect(
      f.controllers.slice(0, -1).every((item) => item.signal.aborted)
    ).toBe(true);
    expect(f.insertions[0].context.signal.aborted).toBe(false);
    f.insertions[0].resolve("paste_requested");
    await flush();
    expectTerminal(f, "done");
    expect(f.overlay.at(-1)).toBe("Done");
    expect(f.insertions).toHaveLength(1);
    expect(f.inserted).toEqual(["Fixture text."]);
    expect(f.machine.cancel(id)).toBe(false);
    expect(f.machine.captureReady(id)).toBe(false);
    expect(f.start()).not.toBe(id);
    f.machine.cancel();
  });

  for (const outcome of [
    "target_changed",
    "clipboard_busy",
    "clipboard_restore_failed",
    "unsupported",
  ] as const) {
    test(`non-success insert outcome ${outcome} terminates without another attempt`, async () => {
      const f = fixture();
      await f.insert();
      f.insertions[0].resolve(outcome);
      await flush();
      expectTerminal(f, "error");
      expect(f.insertions).toHaveLength(1);
      expect(f.inserted).toHaveLength(0);
    });
  }

  for (const checkpoint of [
    "snapshot",
    "starting",
    "listening",
    "capture-complete",
  ] as const) {
    test(`capture failure at ${checkpoint} invalidates, stops, and never inserts`, async () => {
      const f = fixture();
      const id = await reach(f, checkpoint);
      expect(f.machine.failCapture(id)).toBe(true);
      const before = counts(f);
      resolveAll(f);
      await flush();
      expectTerminal(f, "error");
      expect(counts(f)).toEqual(before);
      expect(f.insertions).toHaveLength(0);
    });
  }

  test("capture callbacks from an earlier stage cannot cancel transcription", async () => {
    const f = fixture();
    const id = await f.transcribe();
    expect(f.machine.captureReady(id)).toBe(false);
    expect(f.machine.failCapture(id)).toBe(false);
    expect(f.machine.getStatus().state).toBe("transcribing");
    f.machine.cancel();
  });

  test("concurrent stale snapshot/STT/cleanup/insertion callbacks cannot touch a new session", async () => {
    const f = fixture();
    const ids: string[] = [];
    ids.push(await reach(f, "snapshot"));
    f.machine.cancel();
    ids.push(await reach(f, "transcribing"));
    f.machine.cancel();
    ids.push(await reach(f, "cleaning"));
    f.machine.cancel();
    ids.push(await reach(f, "inserting"));
    f.machine.cancel();
    const fresh = f.start();
    const before = counts(f);
    const latestSnapshot = f.snapshots.at(-1);
    for (const item of f.snapshots) {
      if (item !== latestSnapshot) {
        item.resolve(TARGET);
      }
    }
    for (const item of f.transcriptions) {
      item.resolve("old transcript");
    }
    for (const item of f.cleanups) {
      item.resolve("old cleanup");
    }
    for (const item of f.insertions) {
      item.resolve("paste_requested");
    }
    for (const id of ids) {
      expect(f.machine.captureReady(id)).toBe(false);
      expect(f.machine.failCapture(id)).toBe(false);
      expect(f.machine.cancel(id)).toBe(false);
      expect(f.machine.submitAudio({ ...AUDIO, sessionId: id })).toBe(false);
    }
    await flush();
    expect(f.machine.getStatus()).toEqual({
      sessionId: fresh,
      state: "starting",
    });
    expect(counts(f)).toEqual(before);
    expect(f.inserted).toHaveLength(0);
    f.machine.cancel();
  });

  test("late rejecting snapshot and capture-start promises are contained after Cancel", async () => {
    const captureRequest = deferred<void>();
    const f = fixture({ startCapture: () => captureRequest.promise });
    const first = f.start();
    f.machine.cancel();
    f.snapshots[0].reject(new Error("sensitive fake diagnostic"));
    const second = f.start();
    f.snapshots[1].resolve(TARGET);
    await flush();
    f.machine.cancel(second);
    const fresh = f.start();
    captureRequest.reject(new Error("sensitive fake diagnostic"));
    await flush();
    expect(fresh).not.toBe(first);
    expect(f.machine.getActiveSession()?.id).toBe(fresh);
    expect(f.overlay.at(-1)).toBe("Starting");
    f.machine.cancel();
  });

  for (const port of [
    "snapshot",
    "startCapture",
    "stopCapture",
    "transcribe",
    "clean",
    "insert",
  ] as const) {
    for (const mode of ["throw", "reject"] as const) {
      test(`${port} ${mode} terminates safely and never retries`, async () => {
        let calls = 0;
        const broken = () => {
          calls += 1;
          const error = new Error("sensitive adapter diagnostic");
          if (mode === "throw") {
            throw error;
          }
          return Promise.reject(error);
        };
        const f = fixture({ [port]: broken });
        if (port === "snapshot") {
          f.machine.activate();
        } else if (port === "startCapture") {
          f.start();
          f.snapshots[0].resolve(TARGET);
        } else if (port === "stopCapture") {
          await f.listen();
          f.machine.activate();
        } else if (port === "transcribe") {
          await f.transcribe();
        } else if (port === "clean") {
          await f.clean();
        } else {
          await f.insert();
        }
        await flush();
        expect(f.machine.getStatus()).toEqual({
          sessionId: null,
          state: "error",
        });
        expect(f.machine.getActiveSession()).toBeNull();
        expect(f.controllers.every((item) => item.signal.aborted)).toBe(true);
        expect(f.clock.pending()).toBe(0);
        // A throwing stop gets a distinct terminal discard, never a submit retry.
        expect(calls).toBe(port === "stopCapture" ? 2 : 1);
        if (port !== "stopCapture") {
          expect(f.stops.at(-1)?.reason).toBe("discard");
        }
        const before = counts(f);
        resolveAll(f);
        await flush();
        f.clock.advance(120_000);
        expect(counts(f)).toEqual(before);
        expect(f.inserted).toHaveLength(0);
      });
    }
  }

  for (const port of ["emitOverlay", "emitStatus", "hideOverlay"] as const) {
    test(`${port} exception cannot strand or resurrect the session`, async () => {
      const f = fixture({
        [port]: () => {
          throw new Error("window unavailable");
        },
      });
      if (port === "hideOverlay") {
        await f.listen();
        f.machine.cancel();
        expectTerminal(f, "idle");
      } else {
        f.machine.activate();
        expectTerminal(f, "error");
        expect(f.snapshots).toHaveLength(0);
      }
      expect(f.insertions).toHaveLength(0);
    });
  }

  test("abort-controller factory failure still invalidates and requests release", () => {
    const stops: string[] = [];
    const machine = createSessionMachine({
      createAbortController: () => {
        throw new Error("controller unavailable");
      },
      idPrefix: "factory",
      ports: {
        stopCapture: (context) => {
          stops.push(context.sessionId);
        },
      },
    });
    machine.activate();
    expect(machine.getStatus()).toEqual({ sessionId: null, state: "error" });
    expect(stops).toEqual(["factory_1"]);
  });

  test("unconnected defaults fail closed rather than pretending capture or insertion works", () => {
    const machine = createSessionMachine({ idPrefix: "unconnected" });
    machine.activate();
    expect(machine.getStatus()).toEqual({ sessionId: null, state: "error" });
    expect(machine.getActiveSession()).toBeNull();
    expect(machine.captureReady("unconnected_1")).toBe(false);
  });

  for (const stage of ["transcribing", "cleaning"] as const) {
    test(`${stage} response queued before Cancel cannot advance or insert`, async () => {
      const f = fixture();
      await reach(f, stage);
      const before = counts(f);
      (stage === "transcribing" ? f.transcriptions[0] : f.cleanups[0]).resolve(
        "queued response"
      );
      f.machine.cancel();
      await flush();
      expectTerminal(f, "idle");
      expect(counts(f)).toEqual(before);
      expect(f.insertions).toHaveLength(0);
      expect(f.inserted).toHaveLength(0);
    });
  }

  test("Cancel in terminal Error is a no-op and a new activation still uses a fresh ID", () => {
    const releases: string[] = [];
    const machine = createSessionMachine({
      idPrefix: "error",
      ports: {
        stopCapture: (context) => {
          releases.push(context.sessionId);
        },
      },
    });
    machine.activate();
    expect(machine.getStatus().state).toBe("error");
    expect(machine.cancel()).toBe(false);
    expect(machine.cancel("error_1")).toBe(false);
    expect(releases).toEqual(["error_1"]);
    machine.activate();
    expect(releases).toEqual(["error_1", "error_2"]);
    expect(machine.getStatus()).toEqual({ sessionId: null, state: "error" });
  });

  test("public getters are copies; callers cannot mutate active state or metadata", () => {
    const f = fixture();
    f.start();
    const active = f.machine.getActiveSession();
    const status = f.machine.getStatus();
    if (active) {
      active.state = "done";
    }
    status.state = "done";
    expect(f.machine.getStatus().state).toBe("starting");
    expect(f.machine.getActiveSession()?.state).toBe("starting");
    f.machine.cancel();
  });
});

describe("thin main-owned bindings", () => {
  test("tray callbacks map Listening to recording, other active stages to busy, and Cancel to invalidation", async () => {
    const f = fixture();
    const hooks = sessionTrayCallbacks(f.machine);
    expect(hooks.getReadiness()).toEqual({ key: false, microphone: false });
    hooks.onToggle();
    expect(hooks.getSessionPhase()).toBe("busy");
    const id = f.machine.getActiveSession()?.id as string;
    f.snapshots[0].resolve(TARGET);
    await flush();
    f.machine.captureReady(id);
    expect(hooks.getSessionPhase()).toBe("recording");
    hooks.onToggle();
    expect(hooks.getSessionPhase()).toBe("busy");
    hooks.onCancel();
    expectTerminal(f, "idle");
  });

  test("IPC status/cancel use the main machine; audio/key remain unavailable and stale Cancel is rejected", async () => {
    const f = fixture();
    const url = "file:///app/index.html";
    const mainFrame = { url };
    const sender = {};
    const services = sessionBoundaryServices(f.machine);
    const handle = createIpcBoundary(
      () => ({ mainFrame, sender, url }),
      services
    );
    const event = { sender, senderFrame: mainFrame };
    const id = f.start();
    expect(
      await handle(event, { operation: "subscribeStatus", payload: {} })
    ).toEqual({ ok: true, status: { sessionId: id, state: "starting" } });
    expect(
      await handle(event, { operation: "cancel", payload: { sessionId: id } })
    ).toEqual({ ok: true });
    expectTerminal(f, "idle");
    expect(
      await handle(event, { operation: "cancel", payload: { sessionId: id } })
    ).toEqual({ error: "invalid_session", ok: false });
    expect(services.submitAudio).toBeUndefined();
    expect(services.setupKey).toBeUndefined();
  });
});
