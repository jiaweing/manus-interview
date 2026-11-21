import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "./repo/products/tetherterm/apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "./repo/products/tetherterm/apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { StreamableHTTPClientTransport } from "./repo/products/tetherterm/apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";
import { JSONRPCMessageSchema } from "./repo/products/tetherterm/apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

const product = join(import.meta.dir, "repo/products/tetherterm");
const captures = join(import.meta.dir, "r2-process-captures");
mkdirSync(captures, { recursive: true });
const secrets: string[] = [];
const secret = () => { const value = crypto.getRandomValues(new Uint8Array(32)).toHex(); secrets.push(value); return value; };
const deadline = async <T>(promise: Promise<T>, ms = 10000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Independent real-process probe deadline exceeded")), ms); })]); }
  finally { clearTimeout(timer); }
};
const until = async (predicate: () => boolean) => deadline((async () => { while (!predicate()) await Bun.sleep(5); })());
const safe = (text: string) => secrets.reduce((result, value) => result.replaceAll(value, "[REDACTED-RUNTIME-SENTINEL]"), text);
const containsSecret = (text: string) => secrets.some(value => text.includes(value));
function store(name: string, stdout: string, stderr: string) {
  // Never persist raw secrets even when a regression is detected.
  writeFileSync(join(captures, `${name}.stdout.log`), safe(stdout));
  writeFileSync(join(captures, `${name}.stderr.log`), safe(stderr));
}
async function fixture() {
  const base = await mkdtemp(join(import.meta.dir, "fixture-"));
  const env: Record<string, string> = {
    PATH: "/usr/bin:/bin", HOME: base, USER: "independent-verifier", TERM: "xterm",
    TETHERTERM_APPROVED_ROOT: base,
    TETHERTERM_APPROVED_EXECUTABLES: JSON.stringify(["/usr/bin/python3"]),
    TETHERTERM_PORT: "0", PORT: "0",
    TETHERTERM_TUNNEL_HOSTNAME: "independent-verifier.example.com",
    TETHERTERM_TOKEN_ENV_VAR: "VERIFIER_RUNTIME_BEARER",
    VERIFIER_RUNTIME_BEARER: secret(), LC_API_KEY: secret(), Credential_Sentinel: secret(),
  };
  return { base, env };
}
function isAlive(pid: number) { try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z"; } catch { return false; } }
function observeFamily(rootPid: number, known: Set<number>) {
  const pending = [rootPid];
  const seen = new Set<number>();
  while (pending.length) {
    const pid = pending.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid); known.add(pid);
    try {
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      if (children) pending.push(...children.split(/\s+/).map(Number));
    } catch {}
  }
  const socketInodes = new Set<string>();
  for (const pid of known) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try { const target = readlinkSync(`/proc/${pid}/fd/${fd}`); const match = /^socket:\[(\d+)\]$/.exec(target); if (match) socketInodes.add(match[1]); } catch {}
      }
    } catch {}
  }
  const ports: number[] = [];
  if (socketInodes.size) {
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      for (const line of readFileSync(file, "utf8").trim().split("\n").slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields[3] === "0A" && socketInodes.has(fields[9])) ports.push(parseInt(fields[1].split(":")[1], 16));
      }
    }
  }
  return ports;
}
function tracked(args: string[], env: Record<string, string>, traceName?: string) {
  const tracePath = traceName ? join(captures, `${traceName}.syscalls.log`) : undefined;
  const command = tracePath ? "/usr/bin/strace" : process.execPath;
  const actualArgs = tracePath ? ["-f", "-e", "trace=bind,listen", "-o", tracePath, process.execPath, ...args] : args;
  const child = spawn(command, actualArgs, { cwd: product, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout!.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr!.on("data", chunk => { stderr += chunk.toString(); });
  const known = new Set<number>();
  const listeners = new Set<number>();
  const tick = () => { if (child.pid) for (const port of observeFamily(child.pid, known)) listeners.add(port); };
  const interval = setInterval(tick, 2);
  tick();
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", () => reject(new Error("Verifier child process could not launch")));
    child.once("close", (code, signal) => { clearInterval(interval); tick(); resolve({ code, signal }); });
  });
  return { child, closed, known, listeners, tracePath, stdout: () => stdout, stderr: () => stderr,
    async cleanup() {
      clearInterval(interval);
      if (child.pid) observeFamily(child.pid, known);
      for (const pid of [...known].reverse()) { if (isAlive(pid)) try { process.kill(pid, "SIGKILL"); } catch {} }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await deadline(closed);
    },
  };
}

const cases: Array<[string, (env: Record<string, string>, base: string) => void]> = [
  ["missing-config", env => { for (const key of Object.keys(env)) if (key.startsWith("TETHERTERM_")) delete env[key]; }],
  ["invalid-port", env => { env.TETHERTERM_PORT = "65536"; }],
  ["missing-approved-root", env => { delete env.TETHERTERM_APPROVED_ROOT; }],
  ["nonexistent-approved-root", (env, base) => { env.TETHERTERM_APPROVED_ROOT = join(base, "does-not-exist"); }],
  ["invalid-port-secret-redaction", env => { env.TETHERTERM_PORT = env.VERIFIER_RUNTIME_BEARER; }],
  ["invalid-root-secret-redaction", env => { env.TETHERTERM_APPROVED_ROOT = env.VERIFIER_RUNTIME_BEARER; }],
  ["invalid-executable-json-secret-redaction", env => { env.TETHERTERM_APPROVED_EXECUTABLES = env.LC_API_KEY; }],
];
for (const mode of ["stdio", "http"] as const) {
  const allCases = mode === "http" ? [...cases,
    ["missing-token-variable-name", (env: Record<string, string>) => { delete env.TETHERTERM_TOKEN_ENV_VAR; }] as const,
    ["missing-token-env-value", (env: Record<string, string>) => { delete env.VERIFIER_RUNTIME_BEARER; }] as const,
  ] : cases;
  for (const [name, mutate] of allCases) {
    test(`REAL root launcher ${mode}: ${name}`, async () => {
      const f = await fixture(); mutate(f.env, f.base);
      const label = `${mode}-${name}`;
      console.log(`COMMAND ${label}: strace -f -e trace=bind,listen -o <isolated-capture> bun run terminal:${mode}; runtime-only env values never printed`);
      const probe = tracked(["run", `terminal:${mode}`], f.env, label);
      try {
        const result = await deadline(probe.closed);
        const stdout = probe.stdout(), stderr = probe.stderr();
        const trace = readFileSync(probe.tracePath!, "utf8");
        const bindOrListen = /\b(?:bind|listen)\(/.test(trace);
        expect(result.code === 1 && result.signal === null, "bad config must exit 1, not succeed or hang").toBe(true);
        expect(stdout === "", "failed stdio/HTTP launch must emit no stdout").toBe(true);
        expect(/configuration|TETHERTERM_|approved root|HTTP requires/i.test(stderr), "startup error must be plain-text-readable").toBe(true);
        expect(!stderr.includes("\u001b"), "startup errors must not depend on ANSI color").toBe(true);
        expect(!containsSecret(stdout + stderr + trace), "credentials must never enter output or syscall logs").toBe(true);
        expect(!bindOrListen, "strace must observe zero bind/listen calls in entire process tree").toBe(true);
        expect(probe.listeners.size === 0, "no owned PID may own a listening TCP socket").toBe(true);
        expect([...probe.known].every(pid => !isAlive(pid)), "failed launcher must leave no live descendants").toBe(true);
        console.log(`PROBE ${label}: exit=1 stderr_readable=true stdout=EMPTY credential_values_absent=true bind_calls=0 listen_calls=0 owned_listening_sockets=0 descendants_alive=0`);
        console.log(`CAPTURED_STDERR ${label}: ${safe(stderr.trim()).replaceAll("\n", " | ")}`);
      } finally {
        store(label, probe.stdout(), probe.stderr());
        await probe.cleanup(); await rm(f.base, { recursive: true, force: true });
      }
    }, 20000);
  }
}

class CapturedStdioTransport extends StdioClientTransport {
  rawStdout = "";
  rawStderr = "";
  owned: ChildProcess | undefined;
  known = new Set<number>();
  listeners = new Set<number>();
  interval: ReturnType<typeof setInterval> | undefined;
  exit: Promise<{code: number | null; signal: string | null}> | undefined;
  constructor(env: Record<string, string>) {
    super({ command: process.execPath, args: ["run", "terminal:stdio"], cwd: product, env, stderr: "pipe" });
    this.stderr?.on("data", chunk => { this.rawStderr += chunk.toString(); });
  }
  async start() {
    await super.start();
    // Verifier-only observation of SDK's child, never modification of product/server code.
    this.owned = (this as unknown as { _process: ChildProcess })._process;
    this.owned.stdout!.on("data", chunk => { this.rawStdout += chunk.toString(); });
    this.exit = new Promise(resolve => this.owned!.once("close", (code, signal) => resolve({code, signal})));
    this.interval = setInterval(() => {
      if (this.owned?.pid) for (const port of observeFamily(this.owned.pid, this.known)) this.listeners.add(port);
    }, 2);
  }
  async close() { await super.close(); if (this.exit) await deadline(this.exit); clearInterval(this.interval); }
}
for (const config of ["valid-config-with-runtime-secrets", "valid-config-with-no-HTTP-credentials"] as const) {
  test(`REAL stdio root launcher SDK client: ${config}`, async () => {
    const f = await fixture();
    if (config === "valid-config-with-no-HTTP-credentials") {
      delete f.env.TETHERTERM_TOKEN_ENV_VAR; delete f.env.TETHERTERM_TUNNEL_HOSTNAME; delete f.env.VERIFIER_RUNTIME_BEARER;
    }
    const label = `stdio-${config}`;
    const transport = new CapturedStdioTransport(f.env);
    const client = new Client({ name: "independent-r2-stdio-verifier", version: "1.0.0" });
    let errors = 0; client.onerror = () => { errors++; };
    console.log(`COMMAND ${label}: official SDK StdioClientTransport -> bun run terminal:stdio`);
    try {
      await deadline(client.connect(transport));
      expect(client.getServerVersion()?.name === "tetherterm").toBe(true);
      const result = await deadline(client.listTools());
      expect(Array.isArray(result.tools)).toBe(true);
      expect(client.getServerCapabilities()?.tools !== undefined).toBe(true);
      await deadline(client.close());
      const exit = await transport.exit!;
      expect(exit.code === 0 && exit.signal === null, "valid stdio must exit cleanly after EOF").toBe(true);
      expect(errors).toBe(0);
      expect(transport.rawStderr.includes("TetherTerm MCP ready on stdio")).toBe(true);
      expect(transport.rawStdout.endsWith("\n")).toBe(true);
      const lines = transport.rawStdout.trim().split(/\r?\n/);
      expect(lines.length >= 2).toBe(true);
      for (const line of lines) expect(JSONRPCMessageSchema.safeParse(JSON.parse(line)).success).toBe(true);
      expect(!containsSecret(transport.rawStdout + transport.rawStderr), "runtime bearer/credentials must be absent from all protocol and diagnostic output").toBe(true);
      expect(transport.listeners.size).toBe(0);
      expect([...transport.known].every(pid => !isAlive(pid))).toBe(true);
      console.log(`PROBE ${label}: SDK_initialize=OK SDK_tools/list=OK tools_count=${result.tools.length} SDK_errors=0 stdout_protocol_only=true JSONRPC_lines=${lines.length} stderr_startup=OK EOF_exit=0 credentials_in_output=false listening_sockets=0`);
      console.log(`CAPTURED_STDERR ${label}: ${safe(transport.rawStderr.trim()).replaceAll("\n", " | ")}`);
    } finally {
      await deadline(client.close()); await transport.close();
      store(label, transport.rawStdout, transport.rawStderr);
      await rm(f.base, { recursive: true, force: true });
    }
  }, 20000);
}

test("REAL HTTP root launcher: valid config SDK client and positive listener control", async () => {
  const f = await fixture(); const label = "http-valid-config";
  const probe = tracked(["run", "terminal:http"], f.env);
  const client = new Client({ name: "independent-r2-http-verifier", version: "1.0.0" });
  let errors = 0; client.onerror = () => { errors++; };
  console.log("COMMAND http-valid-config: bun run terminal:http -> official SDK StreamableHTTPClientTransport; ephemeral configured port 0; Authorization header supplied only in memory");
  try {
    await until(() => /http:\/\/127\.0\.0\.1:(\d+)\/mcp/.test(probe.stderr()));
    const port = Number(probe.stderr().match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/)![1]);
    await until(() => probe.listeners.has(port));
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${f.env.VERIFIER_RUNTIME_BEARER}` } } });
    await deadline(client.connect(transport));
    const result = await deadline(client.listTools());
    expect(client.getServerVersion()?.name === "tetherterm").toBe(true);
    expect(client.getServerCapabilities()?.tools !== undefined).toBe(true);
    expect(Array.isArray(result.tools)).toBe(true);
    expect(errors).toBe(0);
    await deadline(client.close());
    // Only the owned launcher's process tree is signalled. Bun's wrapper waits for its real server child.
    const pids = [...probe.known];
    const serverPid = pids.find(pid => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("apps/server/src/http.ts"); } catch { return false; } });
    expect(serverPid !== undefined).toBe(true);
    process.kill(serverPid!, "SIGTERM");
    const exit = await deadline(probe.closed);
    expect(exit.code === 0 && exit.signal === null).toBe(true);
    expect(probe.stdout() === "").toBe(true);
    expect(!containsSecret(probe.stdout() + probe.stderr())).toBe(true);
    expect([...probe.known].every(pid => !isAlive(pid))).toBe(true);
    let open = false;
    try { await fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(500) }); open = true; } catch {}
    expect(open).toBe(false);
    console.log(`PROBE http-valid-config: ephemeral_port=${port} real_owned_listener_observed=true SDK_initialize=OK SDK_tools/list=OK tools_count=${result.tools.length} SDK_errors=0 stdout=EMPTY credential_values_absent=true SIGTERM_exit=0 socket_after_shutdown=CLOSED descendants_alive=0`);
    console.log(`CAPTURED_STDERR ${label}: ${safe(probe.stderr().trim()).replaceAll("\n", " | ")}`);
  } finally {
    await deadline(client.close()); store(label, probe.stdout(), probe.stderr());
    await probe.cleanup(); await rm(f.base, { recursive: true, force: true });
  }
}, 20000);

test("syscall trace observer positive control detects a REAL HTTP launcher bind and listen", async () => {
  const f = await fixture(); const label = "http-strace-positive-control";
  // Direct real entrypoint ensures the traced child itself receives graceful shutdown.
  const probe = tracked(["apps/server/src/http.ts"], f.env, label);
  try {
    await until(() => /http:\/\/127\.0\.0\.1:(\d+)\/mcp/.test(probe.stderr()));
    const port = Number(probe.stderr().match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/)![1]);
    await until(() => probe.listeners.has(port));
    const trace = readFileSync(probe.tracePath!, "utf8");
    expect(/bind\(/.test(trace) && /listen\(/.test(trace)).toBe(true);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${f.env.VERIFIER_RUNTIME_BEARER}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: "2025-03-26", capabilities: {}, clientInfo: {name: "trace-positive-control", version: "1"}}}) });
    expect(response.status === 200).toBe(true); await response.text();
    const serverPid = [...probe.known].find(pid => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").startsWith(process.execPath + "\0"); } catch { return false; } });
    expect(serverPid !== undefined).toBe(true); process.kill(serverPid!, "SIGTERM");
    expect((await deadline(probe.closed)).code === 0).toBe(true);
    expect(!containsSecret(probe.stdout() + probe.stderr() + trace)).toBe(true);
    console.log(`PROBE syscall-positive-control: REAL_HTTP_200=true ephemeral_port=${port} bind_observed=true listen_observed=true graceful_exit=0`);
  } finally { store(label, probe.stdout(), probe.stderr()); await probe.cleanup(); await rm(f.base, { recursive: true, force: true }); }
}, 20000);

test("runtime sentinel scan of ALL captured stdout/stderr and product/evidence log files", () => {
  const files: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".log")) files.push(path);
    }
  }
  walk(product); walk(captures); walk("/home/ubuntu/swarm/evidence");
  let leaked = false;
  for (const file of files) if (containsSecret(readFileSync(file, "utf8"))) leaked = true;
  expect(!leaked, "no runtime bearer/credential value may appear in any saved log").toBe(true);
  console.log(`PROBE log-scan: files_scanned=${files.length} runtime_sentinels=${secrets.length} raw_stdout/stderr_scanned=true token_values_in_saved_logs=false`);
});
