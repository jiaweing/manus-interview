import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { HelperClient, HelperRequestError } from "../../src/main/helper/client";
import {
  type InsertOutcome,
  MAX_PENDING_REQUESTS,
  parseResponse,
} from "../../src/main/helper/protocol";

const target = { focus: "0x5678", foreground: "0x1234" };
const clients: HelperClient[] = [];
function fixture(mode: string, timeout = 2000) {
  const child = spawn(
    process.execPath,
    [resolve(import.meta.dir, "fake-helper.ts"), mode],
    { shell: false, stdio: ["pipe", "pipe", "pipe"] }
  );
  const writes = spyOn(child.stdin, "write");
  const client = new HelperClient(child, timeout);
  clients.push(client);
  return { client, writes };
}
afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close();
  }
});

describe("helper main-process client", () => {
  test("PASS valid snapshot and split response framing", async () => {
    async function expectSnapshot(mode: string): Promise<void> {
      const { client } = fixture(mode);
      expect(await client.snapshot()).toEqual(target);
    }
    await expectSnapshot("valid");
    await expectSnapshot("split");
  });
  for (const outcome of [
    "target_changed",
    "clipboard_busy",
    "unsupported",
    "paste_requested",
  ] as InsertOutcome[]) {
    test(`PASS typed insert outcome ${outcome} (fixture only)`, async () => {
      const { client } = fixture(`outcome-${outcome}`);
      expect(await client.insert(target, "session", "hello 你好 🎙")).toBe(
        outcome
      );
    });
  }
  for (const mode of [
    "malformed",
    "wrong-id",
    "null-id",
    "extra",
    "wrong-type",
    "wrong-op",
    "duplicate-key",
    "invalid-utf8",
    "overlong",
    "truncated",
    "exit",
  ]) {
    test(`PASS ${mode === "exit" ? "helper exit" : "malformed response"}: ${mode}; no retry`, async () => {
      const { client, writes } = fixture(mode);
      const first = client.snapshot();
      const second = client.snapshot();
      const results = await Promise.allSettled([first, second]);
      expect(results.every((result) => result.status === "rejected")).toBe(
        true
      );
      expect(writes).toHaveBeenCalledTimes(2);
      await expect(
        client.insert(target, "later-session", "not inserted")
      ).rejects.toBeInstanceOf(Error);
      expect(writes).toHaveBeenCalledTimes(2);
    });
  }
  for (const mode of ["malformed", "exit"]) {
    test(`PASS pending insert ${mode} is terminal; never request another insertion`, async () => {
      const { client, writes } = fixture(mode);
      await expect(
        client.insert(target, "first-session", "hello")
      ).rejects.toBeInstanceOf(Error);
      await expect(
        client.insert(target, "second-session", "hello")
      ).rejects.toBeInstanceOf(Error);
      expect(writes).toHaveBeenCalledTimes(1);
    });
  }
  test("PASS helper timeout is terminal and never replays insert", async () => {
    const { client, writes } = fixture("silent", 100);
    await expect(client.insert(target, "session", "hello")).rejects.toThrow(
      "timed out"
    );
    await expect(client.insert(target, "session", "hello")).rejects.toThrow(
      "timed out"
    );
    expect(writes).toHaveBeenCalledTimes(1);
  });
  test("PASS no usable target is a typed rejection, not an automatic insertion", async () => {
    const { client, writes } = fixture("error");
    try {
      await client.snapshot();
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HelperRequestError);
      expect((error as HelperRequestError).code).toBe("no_target");
    }
    expect(writes).toHaveBeenCalledTimes(1);
  });
  test("PASS invalid insert requests never write to the helper", async () => {
    const { client, writes } = fixture("valid");
    await (
      [
        [{ ...target, foreground: "0x0" }, "s", "text"],
        [{ ...target, extra: 1 }, "s", "text"],
        [target, "bad session", "text"],
        [target, "s".repeat(129), "text"],
        [target, "s", ""],
        [target, "s", "a\0b"],
        [target, "s", "\ud800"],
        [target, "s", "\udc00"],
        [target, "s", "x".repeat(32_769)],
        [target, "s", "🎙".repeat(8193)],
      ] as [typeof target, string, string][]
    ).reduce(async (previous, invalid) => {
      await previous;
      await expect(client.insert(...invalid)).rejects.toThrow(
        "Invalid helper insert request"
      );
    }, Promise.resolve());
    expect(writes).toHaveBeenCalledTimes(0);
    expect(await client.insert(target, "s", "x".repeat(32_768))).toBe(
      "unsupported"
    );
  });
  test("PASS escaped text exceeding wire line bound never writes", async () => {
    const { client, writes } = fixture("valid");
    await expect(
      client.insert(target, "s", "\x01".repeat(32_768))
    ).rejects.toThrow("line limit");
    expect(writes).toHaveBeenCalledTimes(0);
  });
  test("PASS pending request limit is bounded", async () => {
    const { client, writes } = fixture("silent", 2000);
    const pending = Array.from({ length: MAX_PENDING_REQUESTS }, () =>
      client.snapshot()
    );
    const settled = Promise.allSettled(pending);
    await expect(client.snapshot()).rejects.toThrow("Too many pending");
    expect(writes).toHaveBeenCalledTimes(MAX_PENDING_REQUESTS);
    client.close();
    expect(
      (await settled).every((result) => result.status === "rejected")
    ).toBe(true);
  });
  test("PASS spawn failure and closure are terminal", async () => {
    const missing = HelperClient.start(
      resolve(import.meta.dir, "missing-helper.exe")
    );
    clients.push(missing);
    await expect(missing.snapshot()).rejects.toBeInstanceOf(Error);
    await expect(missing.insert(target, "s", "text")).rejects.toBeInstanceOf(
      Error
    );
    const { client, writes } = fixture("valid");
    client.close();
    await expect(client.snapshot()).rejects.toThrow("closed");
    expect(writes).toHaveBeenCalledTimes(0);
    expect(() => HelperClient.start("relative.exe")).toThrow("absolute path");
  });
  test("PASS portable C++ helper round trip and app-lifetime insert deduplication", async () => {
    const executable = resolve(
      import.meta.dir,
      "../build/protocol-fixtures" +
        (process.platform === "win32" ? ".exe" : "")
    );
    const child = spawn(executable, ["--serve"], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new HelperClient(child);
    clients.push(client);
    expect(await client.snapshot()).toEqual(target);
    expect(await client.insert(target, "unique", 'Unicode 你好 🎙\n"\\')).toBe(
      "unsupported"
    );
    await expect(
      client.insert(target, "unique", "different text")
    ).rejects.toMatchObject({ code: "duplicate_session" });
    expect(await client.insert(target, "another", "hello")).toBe("unsupported");
  });
});

describe("strict helper response schema", () => {
  test("PASS unknown fields, invalid handles, wrong types, outcomes and duplicate keys rejected", () => {
    for (const line of [
      "null",
      "[]",
      "not json",
      '{"requestId":"r","ok":true}',
      '{"requestId":"r","ok":true,"outcome":"ok"}',
      '{"requestId":"r","ok":false,"error":"arbitrary"}',
      '{"requestId":"r","ok":true,"outcome":"unsupported","extra":1}',
      '{"requestId":"r","ok":true,"target":{"foreground":"0x0","focus":"0x123"}}',
      '{"requestId":"r","ok":true,"target":{"foreground":"0x1","focus":123}}',
      '{"requestId":"r","ok":true,"target":{"foreground":"0x1","focus":"0x2","extra":1}}',
      '{"requestId":"r","ok":true,"outcome":"unsupported","\\u006fk":true}',
      '{"requestId":"r","ok":true,"target":{"foreground":"0x1","focus":"0x2","focus":"0x2"}}',
    ]) {
      expect(() => parseResponse(line)).toThrow();
    }
  });
});
