import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelPin,
  PRODUCTION_MODEL_CATALOG,
  PRODUCTION_MODEL_HOSTS,
} from "../src/main/models/catalog";
import { ModelManager } from "../src/main/models/model-manager";
import type { ModelStatus } from "../src/shared/model-contract";

const bytes = Buffer.from("tiny-fixture-model-weights-only:".repeat(128));
const half = Math.floor(bytes.length / 2);
const hash = createHash("sha256").update(bytes).digest("hex");
const pin: ModelPin = {
  bytes: bytes.length,
  id: "fixture-small",
  sha256: hash,
  url: "https://models.test/model",
};
const cleanups: (() => Promise<void>)[] = [];
const FIXTURE_RANGE = /^bytes=(\d+)-$/;

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function fixture(handler?: Handler, overrides: Partial<ModelPin> = {}) {
  const userData = await mkdtemp(join(tmpdir(), "caret-models-"));
  const requests: { path: string; range: string | undefined }[] = [];
  let transferred = 0;
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? "", range: request.headers.range });
    if (handler) {
      handler(request, response);
      return;
    }
    const offset = Number(
      FIXTURE_RANGE.exec(request.headers.range ?? "")?.[1] ?? 0
    );
    const body = bytes.subarray(offset);
    transferred += body.length;
    if (offset) {
      response.statusCode = 206;
      response.setHeader(
        "Content-Range",
        `bytes ${offset}-${bytes.length - 1}/${bytes.length}`
      );
    }
    response.setHeader("Content-Length", body.length);
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server failed to bind");
  }
  // Test-only transport maps an HTTPS pin to a local HTTP fixture. All URL,
  // redirects, stream, disk, hashing and resume logic remain the real manager.
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await fetch(
      `http://127.0.0.1:${address.port}${url.pathname}`,
      init
    );
    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
    });
  };
  const options = {
    allowedHosts: ["models.test"],
    catalog: [{ ...pin, ...overrides }],
    fetch: fetcher,
    userData,
  };
  const manager = new ModelManager(options);
  const model = join(userData, "models", `${pin.id}.bin`);
  const partial = `${model}.partial`;
  cleanups.push(async () => {
    manager.cancelAll();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await chmod(join(userData, "models"), 0o700).catch(() => {
      /* May not exist. */
    });
    await rm(userData, { force: true, recursive: true });
  });
  return {
    manager,
    model,
    options,
    partial,
    requests,
    transferred: () => transferred,
    userData,
  };
}

function absent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => false,
    () => true
  );
}

async function expectFailure(f: Awaited<ReturnType<typeof fixture>>) {
  await expect(f.manager.start(pin.id)).rejects.toThrow();
  expect(await f.manager.status(pin.id)).toEqual({
    modelId: pin.id,
    state: "failed",
  });
  expect(await absent(f.model)).toBe(true);
  expect(await absent(f.partial)).toBe(true);
}

describe("pinned model download and verification", () => {
  test("success atomically installs only after hash, reports progress and ready", async () => {
    const f = await fixture();
    expect(await f.manager.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "absent",
    });
    const events: ModelStatus[] = [];
    const unsubscribe = f.manager.subscribe((status) => {
      events.push(status);
      if (status.state === "downloading") {
        expect(status.percent).toBeGreaterThanOrEqual(0);
        expect(status.percent).toBeLessThanOrEqual(100);
      }
    });
    expect(await f.manager.start(pin.id)).toBe(f.model);
    expect(await readFile(f.model)).toEqual(bytes);
    expect(await absent(f.partial)).toBe(true);
    expect(events.at(-1)).toEqual({ modelId: pin.id, state: "ready" });
    expect(
      events.some(
        (event) => event.state === "downloading" && event.percent === 100
      )
    ).toBe(true);
    expect(await f.manager.getVerifiedPath(pin.id)).toBe(f.model);
    unsubscribe();
  });

  test("resume crash-left partial without re-downloading completed bytes", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, bytes.subarray(0, half));
    await f.manager.start(pin.id);
    expect(f.requests).toEqual([{ path: "/model", range: `bytes=${half}-` }]);
    expect(f.transferred()).toBe(bytes.length - half);
    expect(await readFile(f.model)).toEqual(bytes);
  });

  test("network interruption resumes in the same operation", async () => {
    let calls = 0;
    const f = await fixture((request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(200, { "Content-Length": bytes.length });
        response.write(bytes.subarray(0, half));
        setTimeout(() => response.destroy(), 25);
      } else {
        expect(request.headers.range).toBe(`bytes=${half}-`);
        response.writeHead(206, {
          "Content-Range": `bytes ${half}-${bytes.length - 1}/${bytes.length}`,
        });
        response.end(bytes.subarray(half));
      }
    });
    await f.manager.start(pin.id);
    expect(calls).toBe(2);
    expect(await readFile(f.model)).toEqual(bytes);
  });

  test("truncated graceful response is removed", async () => {
    const f = await fixture((_request, response) => {
      response.write(bytes.subarray(0, half));
      response.end();
    });
    await expectFailure(f);
  });

  test("transport truncation exhausts retry and removes partial", async () => {
    const f = await fixture((_request, response) => {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.write(bytes.subarray(0, half));
      setTimeout(() => response.destroy(), 10);
    });
    await expectFailure(f);
    expect(f.requests).toHaveLength(2);
  });

  test("same-size corrupted content fails SHA-256", async () => {
    const corrupted = Buffer.from(bytes);
    corrupted[half] = (corrupted[half] + 1) % 256;
    const f = await fixture((_request, response) => response.end(corrupted));
    await expectFailure(f);
  });

  test("wrong catalog hash rejects otherwise correct response", async () => {
    const f = await fixture(undefined, { sha256: "0".repeat(64) });
    await expectFailure(f);
  });

  test("oversize chunked response never writes above pinned cap", async () => {
    const f = await fixture((_request, response) => {
      response.write(bytes);
      response.end(Buffer.from("overflow"));
    });
    const lengths: Promise<number>[] = [];
    f.manager.subscribe((status) => {
      if (status.state === "downloading") {
        lengths.push(
          lstat(f.partial).then(
            (s) => s.size,
            () => 0
          )
        );
      }
    });
    await expectFailure(f);
    expect(
      (await Promise.all(lengths)).every((size) => size <= pin.bytes)
    ).toBe(true);
  });

  for (const location of [
    "http://models.test/model",
    "https://evil.test/model",
    "https://models.test.evil.test/model",
    "https://user:password@models.test/model",
    "https://models.test:444/model",
  ]) {
    test(`reject redirect ${location}`, async () => {
      const f = await fixture((_request, response) => {
        response.writeHead(302, { Location: location });
        response.end();
      });
      await expectFailure(f);
      expect(f.requests).toHaveLength(1);
    });
  }

  test("allowlisted relative HTTPS redirect is followed manually", async () => {
    const f = await fixture((request, response) => {
      if (request.url === "/model") {
        response.writeHead(302, { Location: "/weights" });
        response.end();
      } else {
        response.end(bytes);
      }
    });
    await f.manager.start(pin.id);
    expect(f.requests.map((request) => request.path)).toEqual([
      "/model",
      "/weights",
    ]);
  });

  test("redirect loops have a bounded request count", async () => {
    const f = await fixture((_request, response) => {
      response.writeHead(302, { Location: "/model" });
      response.end();
    });
    await expectFailure(f);
    expect(f.requests).toHaveLength(6);
  });

  test("cancel through AbortSignal stops transfer and deletes partial", async () => {
    const f = await fixture((_request, response) => {
      response.write(bytes.subarray(0, half));
    });
    const controller = new AbortController();
    f.manager.subscribe((status) => {
      if (status.state === "downloading" && status.percent > 0) {
        controller.abort();
      }
    });
    await expect(f.manager.start(pin.id, controller.signal)).rejects.toThrow();
    expect(await absent(f.partial)).toBe(true);
    expect(await absent(f.model)).toBe(true);
    expect(await f.manager.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "absent",
    });
  });

  test("cancel by ID waits for cleanup", async () => {
    const f = await fixture((_request, response) =>
      response.write(bytes.subarray(0, half))
    );
    let started: () => void = () => {
      /* Set below. */
    };
    const progress = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.manager.subscribe((status) => {
      if (status.state === "downloading" && status.percent > 0) {
        started();
      }
    });
    const downloading = f.manager.start(pin.id);
    const outcome = downloading.then(
      () => "completed",
      () => "cancelled"
    );
    await progress;
    await f.manager.cancel(pin.id);
    expect(await outcome).toBe("cancelled");
    expect(await absent(f.partial)).toBe(true);
  });

  test("pre-aborted caller sends no requests and removes crash-left partial", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, bytes.subarray(0, half));
    await expect(
      f.manager.start(pin.id, AbortSignal.abort())
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    expect(await absent(f.partial)).toBe(true);
  });

  test("post-verification file swap is detected before use and removed", async () => {
    const f = await fixture();
    await f.manager.start(pin.id);
    await f.manager.getVerifiedPath(pin.id);
    await writeFile(f.model, Buffer.alloc(bytes.length, 0xff));
    await expect(f.manager.getVerifiedPath(pin.id)).rejects.toThrow();
    expect(await absent(f.model)).toBe(true);
    expect(await f.manager.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "failed",
    });
  });

  test("new app manager re-verifies installed model; corrupt cached ready is not trusted", async () => {
    const f = await fixture();
    await f.manager.start(pin.id);
    await writeFile(f.model, Buffer.alloc(bytes.length));
    const restarted = new ModelManager(f.options);
    expect(await restarted.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "failed",
    });
    expect(await absent(f.model)).toBe(true);
  });

  test("valid installed model re-verifies on restart without network", async () => {
    const f = await fixture();
    await f.manager.start(pin.id);
    const restarted = new ModelManager(f.options);
    expect(await restarted.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "ready",
    });
    await restarted.start(pin.id);
    expect(f.requests).toHaveLength(1);
  });

  test("concurrent start shares one promise and one writer", async () => {
    const f = await fixture();
    const one = f.manager.start(pin.id);
    const two = f.manager.start(pin.id);
    expect(one).toBe(two);
    await Promise.all([one, two]);
    expect(f.requests).toHaveLength(1);
  });

  test("disk-write permission error fails closed and cleans partial", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    await chmod(join(f.userData, "models"), 0o500);
    await expectFailure(f);
  });

  test("server ignores Range: restart rather than append duplicate bytes", async () => {
    const f = await fixture((_request, response) => response.end(bytes));
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, bytes.subarray(0, half));
    await f.manager.start(pin.id);
    expect(await readFile(f.model)).toEqual(bytes);
    expect(f.requests[0]?.range).toBe(`bytes=${half}-`);
  });

  test("wrong Content-Range offset fails rather than installing", async () => {
    const f = await fixture((_request, response) => {
      response.writeHead(206, {
        "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      });
      response.end(bytes);
    });
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, bytes.subarray(0, half));
    await expectFailure(f);
  });

  test("already complete partial is verified and renamed with zero download", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, bytes);
    await f.manager.start(pin.id);
    expect(f.requests).toHaveLength(0);
    expect(await readFile(f.model)).toEqual(bytes);
  });

  test("oversize existing partial is deleted before any request", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    await writeFile(f.partial, Buffer.alloc(bytes.length + 1));
    await expectFailure(f);
    expect(f.requests).toHaveLength(0);
  });

  test("symlink partial cannot write outside models directory", async () => {
    const f = await fixture();
    await mkdir(join(f.userData, "models"));
    const sentinel = join(f.userData, "sentinel");
    await writeFile(sentinel, "untouched");
    await symlink(sentinel, f.partial);
    await expectFailure(f);
    expect(await readFile(sentinel, "utf8")).toBe("untouched");
  });

  test("HTTP error status is rejected and retry works after failure", async () => {
    let calls = 0;
    const f = await fixture((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(503);
        response.end("unavailable");
      } else {
        response.end(bytes);
      }
    });
    await expectFailure(f);
    await f.manager.start(pin.id);
    expect(await f.manager.status(pin.id)).toEqual({
      modelId: pin.id,
      state: "ready",
    });
  });

  test("unknown ID and invalid catalog cannot select arbitrary URL/path", async () => {
    const f = await fixture();
    expect(() => f.manager.start("../../escape")).toThrow();
    for (const invalid of [
      { id: "../escape" },
      { url: "http://models.test/model" },
      { bytes: -1 },
      { sha256: "not-a-hash" },
    ]) {
      expect(
        () =>
          new ModelManager({ ...f.options, catalog: [{ ...pin, ...invalid }] })
      ).toThrow();
    }
    expect(f.requests).toHaveLength(0);
  });

  test("throwing progress consumer cannot corrupt the transfer", async () => {
    const f = await fixture();
    f.manager.subscribe(() => {
      throw new Error("fixture listener");
    });
    await f.manager.start(pin.id);
    expect(await readFile(f.model)).toEqual(bytes);
  });

  test("production catalog and host list are immutable and exact", () => {
    expect(Object.isFrozen(PRODUCTION_MODEL_CATALOG)).toBe(true);
    expect(PRODUCTION_MODEL_CATALOG.every(Object.isFrozen)).toBe(true);
    expect(PRODUCTION_MODEL_HOSTS).toEqual([
      "huggingface.co",
      "us.aws.cdn.hf.co",
    ]);
    expect(PRODUCTION_MODEL_CATALOG.map((entry) => entry.id)).toEqual([
      "whisper-small",
      "whisper-medium",
    ]);
  });
});
