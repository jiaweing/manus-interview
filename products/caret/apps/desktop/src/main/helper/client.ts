import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  type HelperErrorCode,
  type HelperRequest,
  type InsertOutcome,
  isIdentifier,
  isTarget,
  isText,
  MAX_LINE_BYTES,
  MAX_PENDING_REQUESTS,
  parseResponse,
  type Target,
} from "./protocol";

export class HelperRequestError extends Error {
  constructor(readonly code: HelperErrorCode) {
    super(`Helper rejected request: ${code}`);
    this.name = "HelperRequestError";
  }
}
interface Pending {
  op: HelperRequest["op"];
  reject: (error: Error) => void;
  resolve: (value: Target | InsertOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Own ONE client/helper for the app lifetime. Never retry/restart after a failed
// insert: the previous process may already have acted. No request/response logs.
export class HelperClient {
  private readonly pending = new Map<string, Pending>();
  private buffer: Buffer = Buffer.alloc(0);
  private failure: Error | undefined;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  static start(executable: string, timeoutMs = 5000): HelperClient {
    if (!isAbsolute(executable)) {
      throw new Error("Helper executable must be an absolute path");
    }
    return new HelperClient(
      spawn(executable, [], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }),
      timeoutMs
    );
  }

  // Injectable transport allows real process-exit/pipe tests without Win32.
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs = 5000
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      child.kill();
      throw new Error("Invalid helper timeout");
    }
    child.stdout.on("data", (data: Buffer) => this.receive(data));
    child.stdout.on("end", () => this.fail(new Error("Helper output ended")));
    child.stdout.on("error", () =>
      this.fail(new Error("Helper output failed"))
    );
    child.stdin.on("error", () => this.fail(new Error("Helper input failed")));
    child.on("error", () => this.fail(new Error("Helper failed to start")));
    child.on("exit", () => this.fail(new Error("Helper terminated")));
    // Drain but never echo native diagnostics (future versions may contain text).
    child.stderr.on("error", () =>
      this.fail(new Error("Helper diagnostic pipe failed"))
    );
    child.stderr.resume();
  }

  snapshot(): Promise<Target> {
    return this.send({
      op: "snapshot",
      requestId: randomUUID(),
    }) as Promise<Target>;
  }
  insert(
    expectedTarget: Target,
    sessionId: string,
    text: string
  ): Promise<InsertOutcome> {
    if (
      !(isTarget(expectedTarget) && isIdentifier(sessionId) && isText(text))
    ) {
      return Promise.reject(new Error("Invalid helper insert request"));
    }
    return this.send({
      expectedTarget,
      op: "insert",
      requestId: randomUUID(),
      sessionId,
      text,
    }) as Promise<InsertOutcome>;
  }
  close(): void {
    this.fail(new Error("Helper client closed"));
  }

  private send(request: HelperRequest): Promise<Target | InsertOutcome> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("Too many pending helper requests"));
    }
    const line = JSON.stringify(request);
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      return Promise.reject(new Error("Helper request exceeds line limit"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error("Helper request timed out")),
        this.timeoutMs
      );
      this.pending.set(request.requestId, {
        op: request.op,
        reject,
        resolve,
        timer,
      });
      this.child.stdin.write(`${line}\n`, "utf8", (error) => {
        if (error) {
          this.fail(new Error("Helper input failed"));
        }
      });
    });
  }
  private receive(chunk: Buffer): void {
    if (this.failure) {
      return;
    }
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (this.buffer.length + end - start > MAX_LINE_BYTES) {
        this.fail(new Error("Helper response exceeds line limit"));
        return;
      }
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(start, end)]);
      if (newline < 0) {
        return;
      }
      const line = this.buffer;
      this.buffer = Buffer.alloc(0);
      try {
        const response = parseResponse(this.decoder.decode(line));
        const item =
          response.requestId === null
            ? undefined
            : this.pending.get(response.requestId);
        if (!item) {
          throw new Error("Unexpected helper response");
        }
        if (
          response.ok &&
          ((item.op === "snapshot" && !("target" in response)) ||
            (item.op === "insert" && !("outcome" in response)))
        ) {
          throw new Error("Wrong helper response operation");
        }
        this.pending.delete(response.requestId as string);
        clearTimeout(item.timer);
        if (response.ok) {
          item.resolve(
            "target" in response ? response.target : response.outcome
          );
        } else {
          item.reject(new HelperRequestError(response.error));
        }
      } catch {
        // Do not include the response (or user text) in an error.
        this.fail(new Error("Malformed or unexpected helper response"));
        return;
      }
      start = newline + 1;
    }
  }
  private fail(error: Error): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    this.buffer = Buffer.alloc(0);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.child.stdin.destroy();
    this.child.kill();
  }
}
