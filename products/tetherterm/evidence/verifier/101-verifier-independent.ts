import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clone = Bun.env.TETHERTERM_CLONE!;
assert(clone);
const product = join(clone, "products/tetherterm");
const { spawnPty } = await import(join(product, "apps/server/src/pty/spawn.ts"));
const timeoutMs = 5000;
async function waitFor(predicate: () => boolean, label: string) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(10);
  }
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Process deadline exceeded")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
const identity = `import os, signal, sys
print('TTY=true STDIN_TTY=%s STDOUT_TTY=%s' % (os.isatty(0), os.isatty(1)), flush=True)
print('IDENTITY PID=%d PGID=%d SID=%d' % (os.getpid(), os.getpgrp(), os.getsid(0)), flush=True)
try:
    print('CONTROLLING=true TCGETPGRP=%d' % os.tcgetpgrp(0), flush=True)
except OSError as e:
    print('CONTROLLING=false TCGETPGRP_ERRNO=%d' % e.errno, flush=True)
`;

async function comparison(mode: "plain" | "helper") {
  let output = "";
  const decoder = new TextDecoder();
  const onData = (bytes: Uint8Array) => { output += decoder.decode(bytes, { stream: true }); };
  const script = identity + (mode === "helper" ? `
assert os.tcgetpgrp(0) == os.getpgrp() == os.getpid()
assert os.getsid(0) == os.getpid()
def winch(signum, frame):
    size = os.get_terminal_size(0)
    print('RESIZED_DIMENSIONS=%dx%d' % (size.lines, size.columns), flush=True)
def interrupt(signum, frame):
    print('CTRL_C=SIGINT', flush=True)
    sys.exit(7)
signal.signal(signal.SIGWINCH, winch)
signal.signal(signal.SIGINT, interrupt)
print('INITIAL_DIMENSIONS=%dx%d' % (os.get_terminal_size(0).lines, os.get_terminal_size(0).columns), flush=True)
print('READY', flush=True)
line = input()
print('OUTPUT_AFTER_WRITE=<%s>' % line, flush=True)
print('INTERRUPT_READY', flush=True)
input()
` : "sys.exit(0)\n");
  let terminal: Bun.Terminal;
  let child: ReturnType<typeof Bun.spawn>;
  if (mode === "plain") {
    terminal = new Bun.Terminal({ cols: 80, rows: 24, data(_terminal, bytes) { onData(bytes); } });
    child = Bun.spawn(["/usr/bin/python3", "-u", "-c", script], {
      cwd: product, env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" }, terminal,
    });
  } else {
    ({ child, terminal } = spawnPty({ executable: "/usr/bin/python3", args: ["-u", "-c", script],
      cwd: product, env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" }, cols: 80, rows: 24, onData }));
  }
  try {
    if (mode === "plain") {
      assert.equal(await bounded(child.exited), 0);
      await waitFor(() => output.includes("TCGETPGRP_ERRNO=25"), "plain ENOTTY output");
      assert(output.includes("STDIN_TTY=True STDOUT_TTY=True"));
      assert(!output.includes("CONTROLLING=true"));
    } else {
      await waitFor(() => output.includes("READY"), "helper ready");
      assert(output.includes("STDIN_TTY=True STDOUT_TTY=True"));
      assert(output.includes(`CONTROLLING=true TCGETPGRP=${child.pid}`));
      assert(output.includes(`IDENTITY PID=${child.pid} PGID=${child.pid} SID=${child.pid}`));
      assert(output.includes("INITIAL_DIMENSIONS=24x80"));
      const bytes = terminal.write("independent-verifier-input\n");
      console.log(`HELPER_WRITE_BYTES=${bytes}`);
      assert.equal(bytes, new TextEncoder().encode("independent-verifier-input\n").length);
      await waitFor(() => output.includes("OUTPUT_AFTER_WRITE=<independent-verifier-input>"), "helper response");
      terminal.resize(119, 41);
      await waitFor(() => output.includes("RESIZED_DIMENSIONS=41x119"), "helper resized");
      await waitFor(() => output.includes("INTERRUPT_READY"), "helper interrupt readiness");
      terminal.write(new Uint8Array([3]));
      await waitFor(() => output.includes("CTRL_C=SIGINT"), "kernel SIGINT after byte 0x03");
      assert.equal(await bounded(child.exited), 7);
      assert.equal(child.exitCode, 7);
    }
    console.log(`=== INDEPENDENT ${mode.toUpperCase()} pid=${child.pid} ===`);
    console.log(output.trim());
    console.log(`RECORDED_EXIT_CODE=${child.exitCode}`);
    console.log(`INDEPENDENT_${mode.toUpperCase()}=PASS`);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await bounded(child.exited);
    terminal.close();
  }
}
await comparison("plain");
await comparison("helper");

const bootCwd = await mkdtemp(join(tmpdir(), "tetherterm-101-verifier-boot-"));
let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  console.log("INDEPENDENT_BOOT_ENV=PATH,PORT ONLY; CWD=unique empty directory; no .env, DB or keys");
  server = Bun.spawn([process.execPath, join(product, "apps/server/src/index.ts")], {
    cwd: bootCwd, env: { PATH: "/usr/bin:/bin", PORT: "0" }, stdout: "pipe", stderr: "pipe",
  });
  const reader = server.stderr.getReader();
  let bootOutput = "";
  let port: string | undefined;
  await bounded((async () => {
    while (!port) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Server failed boot: ${bootOutput}`);
      bootOutput += new TextDecoder().decode(value);
      port = bootOutput.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    }
  })());
  console.log(bootOutput.trim());
  const argv = ["/usr/bin/curl", "--silent", "--show-error", "--fail", "--max-time", "3", "--write-out", "\nHTTP_STATUS=%{http_code}\n", `http://127.0.0.1:${port}/healthz`];
  console.log(`$ ${argv.map(JSON.stringify).join(" ")}`);
  const curl = Bun.spawn(argv, { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  const response = await bounded(new Response(curl.stdout).text());
  const rc = await bounded(curl.exited);
  console.log(response.trim());
  console.log(`CURL_EXIT_CODE=${rc}`);
  assert.equal(rc, 0);
  assert.equal(response, "ok\nHTTP_STATUS=200\n");
  console.log("INDEPENDENT_BOOT=PASS");
  server.kill("SIGTERM");
  await bounded(server.exited);
  await reader.cancel();
  reader.releaseLock();
} finally {
  if (server?.exitCode === null) { server.kill("SIGKILL"); await bounded(server.exited); }
  await rm(bootCwd, { recursive: true, force: true });
}
console.log("INDEPENDENT_VERIFIER_PROBES=PASS");
