import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import type { ModelStatus } from "../../shared/model-contract";
import {
  type ModelPin,
  PRODUCTION_MODEL_CATALOG,
  PRODUCTION_MODEL_HOSTS,
} from "./catalog";

export interface ModelManagerOptions {
  allowedHosts?: readonly string[];
  // Trusted main/test configuration only. Never bind these options to IPC.
  catalog?: readonly ModelPin[];
  fetch?: typeof globalThis.fetch;
  userData: string;
}

const MODEL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const LENGTH = /^\d+$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// biome-ignore lint/suspicious/noBitwiseOperators: Node open flags are a bitmask; O_NOFOLLOW forbids symlink writes.
const WRITE_FLAGS = constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW;

class ModelFailure extends Error {
  constructor() {
    super("Model verification or transfer failed");
  }
}

class NetworkInterruption extends Error {}

function responseOffset(
  response: Response,
  pin: ModelPin,
  previous: number
): number {
  if (!(response.body && [200, 206].includes(response.status))) {
    throw new ModelFailure();
  }
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding !== "identity") {
    throw new ModelFailure();
  }
  const offset = response.status === 206 ? previous : 0;
  if (response.status === 206) {
    const range = RANGE.exec(response.headers.get("content-range") ?? "");
    if (
      !range ||
      Number(range[1]) !== offset ||
      Number(range[2]) !== pin.bytes - 1 ||
      Number(range[3]) !== pin.bytes
    ) {
      throw new ModelFailure();
    }
  }
  if (response.headers.has("content-length")) {
    const length = response.headers.get("content-length") ?? "";
    if (!LENGTH.test(length) || Number(length) !== pin.bytes - offset) {
      throw new ModelFailure();
    }
  }
  return offset;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<{ done: true } | { done: false; value: Uint8Array }> {
  signal.throwIfAborted();
  try {
    const chunk = await reader.read();
    signal.throwIfAborted();
    return chunk.done ? { done: true } : { done: false, value: chunk.value };
  } catch (error) {
    signal.throwIfAborted();
    throw new NetworkInterruption("Model stream interrupted", { cause: error });
  }
}

async function writeChunk(
  file: FileHandle,
  chunk: Uint8Array,
  position: number,
  signal: AbortSignal
): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    signal.throwIfAborted();
    // biome-ignore lint/performance/noAwaitInLoops: Writes must be ordered and bounded, including short writes.
    const { bytesWritten } = await file.write(
      chunk,
      written,
      chunk.length - written,
      position + written
    );
    if (bytesWritten === 0) {
      throw new ModelFailure();
    }
    written += bytesWritten;
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ModelFailure();
    }
    return stat.size;
  } catch (error) {
    if (missing(error)) {
      return null;
    }
    throw error;
  }
}

// Hash the on-disk bytes, not merely bytes supplied by the transport. No cached
// ready flag is accepted by getVerifiedPath; callers must use it at first use.
async function verify(
  path: string,
  pin: ModelPin,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  if ((await fileSize(path)) !== pin.bytes) {
    throw new ModelFailure();
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: Node requires a bitmask to combine read-only and no-follow flags.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < pin.bytes) {
      signal?.throwIfAborted();
      // biome-ignore lint/performance/noAwaitInLoops: A fixed buffer bounds RAM usage when hashing gigabyte models.
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, pin.bytes - position),
        position
      );
      if (bytesRead === 0) {
        throw new ModelFailure();
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await file.stat();
    const named = await lstat(path);
    if (
      hash.digest("hex") !== pin.sha256 ||
      after.size !== pin.bytes ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      named.isSymbolicLink() ||
      named.ino !== after.ino ||
      named.dev !== after.dev
    ) {
      throw new ModelFailure();
    }
    signal?.throwIfAborted();
  } finally {
    await file.close();
  }
}

interface Transfer {
  controller: AbortController;
  promise: Promise<string>;
}

export class ModelManager {
  private readonly directory: string;
  private readonly pins = new Map<string, ModelPin>();
  private readonly hosts: Set<string>;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly states = new Map<string, ModelStatus>();
  private readonly initialized = new Set<string>();
  private readonly active = new Map<string, Transfer>();
  private readonly listeners = new Set<(status: ModelStatus) => void>();

  constructor(options: ModelManagerOptions) {
    this.directory = join(options.userData, "models");
    this.hosts = new Set(options.allowedHosts ?? PRODUCTION_MODEL_HOSTS);
    this.fetcher = options.fetch ?? globalThis.fetch;
    for (const candidate of options.catalog ?? PRODUCTION_MODEL_CATALOG) {
      if (
        !(
          MODEL_ID.test(candidate.id) &&
          HASH.test(candidate.sha256) &&
          Number.isSafeInteger(candidate.bytes)
        ) ||
        candidate.bytes <= 0 ||
        this.pins.has(candidate.id)
      ) {
        throw new ModelFailure();
      }
      this.validateUrl(candidate.url);
      const pin = Object.freeze({ ...candidate });
      this.pins.set(pin.id, pin);
      this.states.set(pin.id, { modelId: pin.id, state: "absent" });
    }
  }

  private pin(id: string): ModelPin {
    const pin = this.pins.get(id);
    if (!pin) {
      throw new ModelFailure();
    }
    return pin;
  }

  private path(id: string): string {
    return join(this.directory, `${id}.bin`);
  }

  private setStatus(status: ModelStatus): void {
    this.states.set(status.modelId, status);
    for (const listener of this.listeners) {
      try {
        listener({ ...status });
      } catch {
        // A consumer cannot interrupt verification, cancellation, or cleanup.
      }
    }
  }

  subscribe(listener: (status: ModelStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async status(id: string): Promise<ModelStatus> {
    const pin = this.pin(id);
    if (!(this.initialized.has(id) || this.active.has(id))) {
      try {
        if ((await fileSize(this.path(id))) !== null) {
          await verify(this.path(id), pin);
          this.setStatus({ modelId: id, state: "ready" });
        }
      } catch {
        await rm(this.path(id), { force: true });
        this.setStatus({ modelId: id, state: "failed" });
      }
      this.initialized.add(id);
    }
    return { ...(this.states.get(id) as ModelStatus) };
  }

  // Concurrent calls share the identical promise. The first caller's signal owns
  // the transfer; later callers may cancel by ID, but cannot create another writer.
  start(id: string, signal?: AbortSignal): Promise<string> {
    const pin = this.pin(id);
    const existing = this.active.get(id);
    if (existing) {
      return existing.promise;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      controller.abort();
    }
    const promise = this.install(pin, controller.signal).finally(() => {
      signal?.removeEventListener("abort", abort);
      this.active.delete(id);
      this.initialized.add(id);
    });
    this.active.set(id, { controller, promise });
    this.progress(pin, 0);
    return promise;
  }

  async cancel(id: string): Promise<void> {
    this.pin(id);
    const active = this.active.get(id);
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => {
        /* Cancellation has already cleaned up. */
      });
    } else {
      await rm(`${this.path(id)}.partial`, { force: true });
    }
  }

  cancelAll(): void {
    for (const transfer of this.active.values()) {
      transfer.controller.abort();
    }
  }

  async getVerifiedPath(id: string, signal?: AbortSignal): Promise<string> {
    const pin = this.pin(id);
    const transfer = this.active.get(id);
    if (transfer) {
      await transfer.promise;
    }
    const path = this.path(id);
    try {
      await verify(path, pin, signal);
      this.initialized.add(id);
      this.setStatus({ modelId: id, state: "ready" });
      return path;
    } catch (error) {
      if (!signal?.aborted) {
        await rm(path, { force: true });
        this.setStatus({ modelId: id, state: "failed" });
      }
      throw error;
    }
  }

  private validateUrl(value: string): URL {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !this.hosts.has(url.hostname) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      throw new ModelFailure();
    }
    return url;
  }

  private async request(
    pin: ModelPin,
    offset: number,
    signal: AbortSignal
  ): Promise<Response> {
    let url = this.validateUrl(pin.url);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      signal.throwIfAborted();
      let response: Response;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Validate each redirect before making the next request.
        response = await this.fetcher(url.href, {
          credentials: "omit",
          headers: {
            "Accept-Encoding": "identity",
            ...(offset ? { Range: `bytes=${offset}-` } : {}),
          },
          redirect: "manual",
          signal,
        });
      } catch (error) {
        signal.throwIfAborted();
        throw new NetworkInterruption("Model request interrupted", {
          cause: error,
        });
      }
      // Detect a transport that silently followed redirects despite manual mode.
      if (response.url) {
        this.validateUrl(response.url);
        if (response.redirected) {
          await response.body?.cancel();
          throw new ModelFailure();
        }
      }
      if (!REDIRECTS.has(response.status)) {
        return response;
      }
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) {
        throw new ModelFailure();
      }
      url = this.validateUrl(new URL(location, url).href);
    }
    throw new ModelFailure();
  }

  private async download(
    pin: ModelPin,
    partial: string,
    signal: AbortSignal
  ): Promise<void> {
    let offset = (await fileSize(partial)) ?? 0;
    if (offset > pin.bytes) {
      throw new ModelFailure();
    }
    if (offset === pin.bytes) {
      return; // A crash after the last write can finish without requesting any bytes.
    }
    const response = await this.request(pin, offset, signal);
    const reader = response.body?.getReader();
    const cancelRead = () => {
      reader?.cancel().catch(() => {
        /* Read cancellation is best-effort. */
      });
    };
    signal.addEventListener("abort", cancelRead, { once: true });
    let file: FileHandle | undefined;
    try {
      if (!reader) {
        throw new ModelFailure();
      }
      // A server ignoring Range restarts at zero, never appends duplicate bytes.
      offset = responseOffset(response, pin, offset);
      file = await open(partial, WRITE_FLAGS, 0o600);
      await file.truncate(offset);
      this.progress(pin, offset);
      let position = offset;
      let complete = false;
      while (!complete) {
        // biome-ignore lint/performance/noAwaitInLoops: Read one chunk at a time to retain backpressure and cancellation.
        const chunk = await readChunk(reader, signal);
        if (chunk.done) {
          complete = true;
        } else {
          if (position + chunk.value.length > pin.bytes) {
            throw new ModelFailure();
          }
          await writeChunk(file, chunk.value, position, signal);
          position += chunk.value.length;
          this.progress(pin, position);
        }
      }
      if (position !== pin.bytes) {
        throw new ModelFailure();
      }
      await file.sync();
    } finally {
      signal.removeEventListener("abort", cancelRead);
      await reader?.cancel().catch(() => {
        /* Abort/network failure already reported. */
      });
      await file?.close();
    }
  }

  private progress(pin: ModelPin, bytes: number): void {
    this.setStatus({
      modelId: pin.id,
      percent: (bytes / pin.bytes) * 100,
      state: "downloading",
    });
  }

  private async install(pin: ModelPin, signal: AbortSignal): Promise<string> {
    const path = this.path(pin.id);
    const partial = `${path}.partial`;
    try {
      signal.throwIfAborted();
      await mkdir(this.directory, { mode: 0o700, recursive: true });
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) {
        throw new ModelFailure();
      }
      if ((await fileSize(path)) !== null) {
        try {
          await verify(path, pin, signal);
          await rm(partial, { force: true });
          this.setStatus({ modelId: pin.id, state: "ready" });
          return path;
        } catch (error) {
          if (!signal.aborted) {
            await rm(path, { force: true });
          }
          throw error;
        }
      }
      this.progress(pin, 0);
      // One transport interruption may resume in-place. Graceful truncation,
      // validation, hash, disk, and exhausted network failures delete the partial.
      try {
        await this.download(pin, partial, signal);
      } catch (error) {
        if (
          !(error instanceof NetworkInterruption) ||
          signal.aborted ||
          !((await fileSize(partial)) ?? 0)
        ) {
          throw error;
        }
        await this.download(pin, partial, signal);
      }
      await verify(partial, pin, signal);
      signal.throwIfAborted();
      await rename(partial, path);
      this.setStatus({ modelId: pin.id, state: "ready" });
      return path;
    } catch (error) {
      try {
        await rm(partial, { force: true });
      } finally {
        this.setStatus({
          modelId: pin.id,
          state: signal.aborted ? "absent" : "failed",
        });
      }
      throw error;
    }
  }
}
