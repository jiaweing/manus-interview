import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type ActiveSession,
  type BoundaryServices,
  createIpcBoundary,
  type SenderContext,
} from "../src/main/ipc-boundary";
import {
  guardRenderer,
  RENDERER_PRIVILEGES,
} from "../src/main/renderer-security";
import {
  createCaretApi,
  type PreloadTransport,
} from "../src/preload/caret-api";
import {
  type AudioSubmission,
  type BoundaryRequest,
  type BoundaryResult,
  type CaretStatus,
  IPC_REQUEST_CHANNEL,
  IPC_STATUS_CHANNEL,
  MAX_AUDIO_BYTES,
  type SessionState,
} from "../src/shared/ipc-contract";

const rendererUrl = "file:///caret/out/renderer/index.html";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Required fixture value is missing");
  }
  return value;
}

function fixture() {
  const sender = {};
  const mainFrame = { url: rendererUrl };
  const event: SenderContext = { sender, senderFrame: mainFrame };
  const effects: string[] = [];
  let active: ActiveSession | null = {
    id: "session-1",
    state: "capture-complete",
  };
  const services: BoundaryServices = {
    cancel: () => {
      effects.push("cancel");
    },
    getActiveSession: () => active,
    getStatus: () => ({
      sessionId: active?.id ?? null,
      state: active?.state ?? "idle",
    }),
    setupKey: () => {
      effects.push("setupKey");
    },
    submitAudio: () => {
      effects.push("submitAudio");
    },
  };
  const handle = createIpcBoundary(
    () => ({ mainFrame, sender, url: rendererUrl }),
    services
  );
  return {
    effects,
    event,
    handle,
    services,
    setActive: (value: ActiveSession | null) => {
      active = value;
    },
  };
}

function audio(overrides: Record<string, unknown> = {}) {
  return {
    operation: "submitAudio",
    payload: {
      audio: new ArrayBuffer(32),
      mimeType: "audio/webm",
      sessionId: "session-1",
      ...overrides,
    },
  };
}

const validRequests = [
  {
    operation: "setupKey",
    payload: { key: "fixture-only-not-a-provider-key" },
  },
  { operation: "subscribeStatus", payload: {} },
  { operation: "cancel", payload: { sessionId: "session-1" } },
  audio(),
];

describe("four permitted operations", () => {
  for (const request of validRequests) {
    test(`PASS ${request.operation}`, async () => {
      const f = fixture();
      const result = await f.handle(f.event, request);
      expect(result.ok).toBe(true);
      expect(f.effects).toEqual(
        request.operation === "subscribeStatus" ? [] : [request.operation]
      );
      if (request.operation === "subscribeStatus") {
        expect(result).toEqual({
          ok: true,
          status: { sessionId: "session-1", state: "capture-complete" },
        });
      }
    });
  }
  test("PASS Opus WebM and exact 10 MB boundary", async () => {
    const f = fixture();
    expect(
      await f.handle(
        f.event,
        audio({
          audio: new ArrayBuffer(MAX_AUDIO_BYTES),
          mimeType: "audio/webm;codecs=opus",
        })
      )
    ).toEqual({ ok: true });
    expect(f.effects).toEqual(["submitAudio"]);
  });
  test("status strips extra main-private fields", async () => {
    const f = fixture();
    f.services.getStatus = () => ({
      key: "private-fixture",
      sessionId: null,
      state: "idle",
      transcript: "private-fixture",
    });
    expect(await f.handle(f.event, validRequests[1])).toEqual({
      ok: true,
      status: { sessionId: null, state: "idle" },
    });
  });
});

describe("untrusted senders rejected before effects", () => {
  const cases: [string, (event: SenderContext) => SenderContext][] = [
    ["other webContents", (event) => ({ ...event, sender: {} })],
    ["missing frame", (event) => ({ ...event, senderFrame: null })],
    [
      "child frame with matching URL",
      (event) => ({ ...event, senderFrame: { url: rendererUrl } }),
    ],
    [
      "external main-frame URL",
      (event) => {
        required(event.senderFrame).url = "https://example.com";
        return event;
      },
    ],
    [
      "different bundled file",
      (event) => {
        required(event.senderFrame).url =
          "file:///caret/out/renderer/other.html";
        return event;
      },
    ],
    [
      "malformed main-frame URL",
      (event) => {
        required(event.senderFrame).url = "invalid";
        return event;
      },
    ],
    [
      "query-string variation",
      (event) => {
        required(event.senderFrame).url += "?remote=true";
        return event;
      },
    ],
  ];
  for (const [name, makeEvent] of cases) {
    for (const request of validRequests) {
      test(`reject ${name}: ${request.operation}`, async () => {
        const f = fixture();
        expect(await f.handle(makeEvent(f.event), request)).toEqual({
          error: "invalid_sender",
          ok: false,
        });
        expect(f.effects).toEqual([]);
      });
    }
  }
  test("bundled same-document fragment stays trusted", async () => {
    const f = fixture();
    required(f.event.senderFrame).url += "#status";
    expect((await f.handle(f.event, validRequests[1])).ok).toBe(true);
  });
});

describe("unknown operations and strict message schemas", () => {
  for (const operation of [
    "helper",
    "exec",
    "fs",
    "ipcRenderer",
    "status",
    "",
    0,
    null,
  ]) {
    test(`reject unknown operation ${String(operation)}`, async () => {
      const f = fixture();
      expect(await f.handle(f.event, { operation, payload: {} })).toEqual({
        error: "unknown_operation",
        ok: false,
      });
      expect(f.effects).toEqual([]);
    });
  }
  const malformed: [string, unknown][] = [
    ["null request", null],
    ["array request", []],
    ["string request", "setupKey"],
    ["missing payload", { operation: "setupKey" }],
    ["extra request field", { ...validRequests[0], command: "insert" }],
    ["null payload", { operation: "setupKey", payload: null }],
    ["array payload", { operation: "subscribeStatus", payload: [] }],
    ["missing key", { operation: "setupKey", payload: {} }],
    ["numeric key", { operation: "setupKey", payload: { key: 1 } }],
    ["empty key", { operation: "setupKey", payload: { key: "" } }],
    ["blank key", { operation: "setupKey", payload: { key: " \n " } }],
    [
      "unbounded key",
      { operation: "setupKey", payload: { key: "x".repeat(4097) } },
    ],
    [
      "extra key field",
      { operation: "setupKey", payload: { command: "exec", key: "fixture" } },
    ],
    [
      "status payload fields",
      { operation: "subscribeStatus", payload: { state: "done" } },
    ],
    ["missing cancel id", { operation: "cancel", payload: {} }],
    ["invalid cancel id", { operation: "cancel", payload: { sessionId: 1 } }],
    ["empty cancel id", { operation: "cancel", payload: { sessionId: "" } }],
    [
      "extra cancel field",
      { operation: "cancel", payload: { force: true, sessionId: "session-1" } },
    ],
    ["invalid audio id", audio({ sessionId: null })],
    ["unbounded audio id", audio({ sessionId: "a".repeat(129) })],
    ["whitespace audio id", audio({ sessionId: "session 1" })],
    ["renderer-supplied state", audio({ state: "capture-complete" })],
    ["renderer-supplied target", audio({ targetHandles: [1, 2] })],
    ["numeric MIME", audio({ mimeType: 1 })],
    [
      "missing audio",
      {
        operation: "submitAudio",
        payload: { mimeType: "audio/webm", sessionId: "session-1" },
      },
    ],
    ["string audio", audio({ audio: "encoded" })],
    ["typed-array audio", audio({ audio: new Uint8Array(32) })],
    ["shared-memory audio", audio({ audio: new SharedArrayBuffer(32) })],
  ];
  for (const [name, request] of malformed) {
    test(`reject ${name}`, async () => {
      const f = fixture();
      expect(await f.handle(f.event, request)).toEqual({
        error: "invalid_payload",
        ok: false,
      });
      expect(f.effects).toEqual([]);
    });
  }
});

describe("audio session, main state, MIME and size", () => {
  for (const operation of ["cancel", "submitAudio"]) {
    for (const active of [
      null,
      { id: "other-session", state: "capture-complete" as const },
    ]) {
      test(`reject ${operation} with ${active ? "mismatching" : "no active"} session`, async () => {
        const f = fixture();
        f.setActive(active);
        const request =
          operation === "submitAudio"
            ? audio()
            : { operation, payload: { sessionId: "session-1" } };
        expect(await f.handle(f.event, request)).toEqual({
          error: "invalid_session",
          ok: false,
        });
        expect(f.effects).toEqual([]);
      });
    }
  }
  for (const state of [
    "starting",
    "listening",
    "transcribing",
    "cleaning",
    "done",
    "error",
  ] satisfies SessionState[]) {
    test(`reject main-owned ${state} state`, async () => {
      const f = fixture();
      f.setActive({ id: "session-1", state });
      expect(await f.handle(f.event, audio())).toEqual({
        error: "invalid_state",
        ok: false,
      });
      expect(f.effects).toEqual([]);
    });
  }
  for (const mimeType of [
    "audio/wav",
    "audio/mp3",
    "video/webm",
    "application/octet-stream",
    "audio/webm;codecs=vorbis",
    "",
    "audio/webm;codecs=opus;untrusted=true",
  ]) {
    test(`reject non-allowed MIME ${mimeType}`, async () => {
      const f = fixture();
      expect(await f.handle(f.event, audio({ mimeType }))).toEqual({
        error: "invalid_mime",
        ok: false,
      });
      expect(f.effects).toEqual([]);
    });
  }
  for (const size of [0, MAX_AUDIO_BYTES + 1]) {
    test(`reject audio size ${size}`, async () => {
      const f = fixture();
      expect(
        await f.handle(f.event, audio({ audio: new ArrayBuffer(size) }))
      ).toEqual({ error: "invalid_size", ok: false });
      expect(f.effects).toEqual([]);
    });
  }
  test("session state is read from main for each request", async () => {
    const f = fixture();
    f.setActive({ id: "session-1", state: "listening" });
    expect((await f.handle(f.event, audio())).ok).toBe(false);
    f.setActive({ id: "session-1", state: "capture-complete" });
    expect((await f.handle(f.event, audio())).ok).toBe(true);
    f.setActive(null);
    expect((await f.handle(f.event, audio())).ok).toBe(false);
    expect(f.effects).toEqual(["submitAudio"]);
  });
  test("future integrations fail closed until installed", async () => {
    const f = fixture();
    Reflect.deleteProperty(f.services, "setupKey");
    Reflect.deleteProperty(f.services, "cancel");
    Reflect.deleteProperty(f.services, "submitAudio");
    async function expectUnavailable(request: unknown): Promise<void> {
      expect(await f.handle(f.event, request)).toEqual({
        error: "unavailable",
        ok: false,
      });
    }
    await expectUnavailable(validRequests[0]);
    await expectUnavailable(validRequests[2]);
    await expectUnavailable(validRequests[3]);
    expect(f.effects).toEqual([]);
  });
  test("handler failures never echo secrets or payloads", async () => {
    const f = fixture();
    f.services.setupKey = () => {
      throw new Error("private-key-and-content-fixture");
    };
    expect(await f.handle(f.event, validRequests[0])).toEqual({
      error: "operation_failed",
      ok: false,
    });
  });
});

function transportFixture() {
  const requests: { channel: string; request: BoundaryRequest }[] = [];
  const listeners = new Set<(event: unknown, status: CaretStatus) => void>();
  let resolve: (result: BoundaryResult) => void = () => {
    /* Intentional no-op in this fixture. */
  };
  const pending = new Promise<BoundaryResult>((done) => {
    resolve = done;
  });
  const transport: PreloadTransport = {
    invoke: (channel, request) => {
      requests.push({ channel, request });
      return pending;
    },
    on: (channel, listener) => {
      expect(channel).toBe(IPC_STATUS_CHANNEL);
      listeners.add(listener);
    },
    removeListener: (channel, listener) => {
      expect(channel).toBe(IPC_STATUS_CHANNEL);
      listeners.delete(listener);
    },
  };
  return { api: createCaretApi(transport), listeners, requests, resolve };
}

describe("preload exposes only four documented capabilities", () => {
  test("no generic IPC/process/filesystem/helper channel", () => {
    const { api } = transportFixture();
    expect(Object.keys(api).sort()).toEqual([
      "cancel",
      "setupKey",
      "submitAudio",
      "subscribeStatus",
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    for (const forbidden of [
      "require",
      "process",
      "fs",
      "ipcRenderer",
      "invoke",
      "send",
      "helper",
      "exec",
    ]) {
      expect(forbidden in api).toBe(false);
    }
  });
  test("every method targets a fixed channel and operation", async () => {
    const f = transportFixture();
    const setup = f.api.setupKey("fixture-key");
    const cancel = f.api.cancel("session-1");
    const submit = f.api.submitAudio(audio().payload as AudioSubmission);
    const unsubscribe = f.api.subscribeStatus(() => {
      /* Intentional no-op in this fixture. */
    });
    expect(f.requests.map(({ channel }) => channel)).toEqual(
      new Array(4).fill(IPC_REQUEST_CHANNEL)
    );
    expect(f.requests.map(({ request }) => request.operation)).toEqual([
      "setupKey",
      "cancel",
      "submitAudio",
      "subscribeStatus",
    ]);
    f.resolve({ ok: true });
    await Promise.all([setup, cancel, submit]);
    unsubscribe();
    expect(f.listeners.size).toBe(0);
  });
  test("status callback receives metadata, not Electron event or private fields", async () => {
    const f = transportFixture();
    const received: CaretStatus[] = [];
    f.api.subscribeStatus((status) => received.push(status));
    f.resolve({ ok: true, status: { sessionId: null, state: "idle" } });
    await Promise.resolve();
    for (const listener of f.listeners) {
      listener({ sender: "must-not-leak" }, {
        key: "must-not-leak",
        sessionId: "session-1",
        state: "listening",
      } as CaretStatus);
    }
    expect(received).toEqual([
      { sessionId: null, state: "idle" },
      { sessionId: "session-1", state: "listening" },
    ]);
  });
  test("unsubscribe suppresses late initial status", async () => {
    const f = transportFixture();
    const received: CaretStatus[] = [];
    f.api.subscribeStatus((status) => received.push(status))();
    f.resolve({ ok: true, status: { sessionId: null, state: "idle" } });
    await Promise.resolve();
    expect(received).toEqual([]);
    expect(f.listeners.size).toBe(0);
  });
  test("a live update cannot be overwritten by an older initial snapshot", async () => {
    const f = transportFixture();
    const received: CaretStatus[] = [];
    f.api.subscribeStatus((status) => received.push(status));
    for (const listener of f.listeners) {
      listener({}, { sessionId: "session-1", state: "listening" });
    }
    f.resolve({ ok: true, status: { sessionId: null, state: "idle" } });
    await Promise.resolve();
    expect(received).toEqual([{ sessionId: "session-1", state: "listening" }]);
  });
});

describe("renderer security configuration and navigation guards (Linux fixtures, not Windows evidence)", () => {
  test("Node integration is off; isolation and sandbox stay on", () => {
    expect(RENDERER_PRIVILEGES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });
  test("main loads bundled UI only and attaches guards before loading", () => {
    const main = readFileSync(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8"
    );
    expect(main).toContain("win.loadFile(rendererPath)");
    expect(main).not.toContain("loadURL");
    expect(main).not.toContain("ELECTRON_RENDERER_URL");
    expect(main.indexOf("guardRenderer(win.webContents)")).toBeLessThan(
      main.indexOf("win.loadFile(rendererPath)")
    );
  });
  test("external navigation, redirects, subframes, webviews and window.open are blocked without URL logs", () => {
    const handlers = new Map<
      string,
      (event: { preventDefault: () => void }) => void
    >();
    let open: (() => { action: "deny" }) | undefined;
    const logs: string[] = [];
    guardRenderer(
      {
        on: (name, listener) => {
          handlers.set(name, listener);
        },
        setWindowOpenHandler: (handler) => {
          open = handler;
        },
      },
      (message) => logs.push(message)
    );
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "will-attach-webview",
    ]) {
      let prevented = false;
      required(handlers.get(name))({
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented).toBe(true);
    }
    expect(required(open)()).toEqual({ action: "deny" });
    expect(logs).toEqual([
      ...new Array(4).fill("Caret: blocked navigation"),
      "Caret: blocked new window",
    ]);
  });
});
