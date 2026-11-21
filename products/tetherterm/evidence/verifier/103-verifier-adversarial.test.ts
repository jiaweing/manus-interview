import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, startWithConfig } from "./repo/products/tetherterm/apps/server/src/config.ts";
import { spawnWithPolicy } from "./repo/products/tetherterm/apps/server/src/policy.ts";
import { logDiagnostic } from "./repo/products/tetherterm/apps/server/src/diagnostics.ts";

const product = join(import.meta.dir, "repo/products/tetherterm");
const executable = Bun.which("python3", { PATH: "/usr/bin:/bin" })!;
const secret = () => crypto.getRandomValues(new Uint8Array(32)).toHex();
const deadline = async <T>(promise: Promise<T>, ms = 5000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Owned probe deadline exceeded")), ms);
    })]);
  } finally { clearTimeout(timer); }
};
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "tetherterm-103-adversarial-"));
  const root = join(base, "root");
  const evil = join(base, "root-evil");
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(evil);
  await symlink(evil, join(root, "escape"));
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: root,
    USER: "verifier",
    TETHERTERM_APPROVED_ROOT: root,
    TETHERTERM_APPROVED_EXECUTABLES: JSON.stringify([executable]),
    TETHERTERM_PORT: "0",
    TETHERTERM_TUNNEL_HOSTNAME: "verifier.example.com",
    TETHERTERM_TOKEN_ENV_VAR: "LANG",
    LANG: secret(),
  };
  return { base, root, evil, env, config: await loadConfig("http", env) };
}

const denials = [
  ["symlink escape", (f: Awaited<ReturnType<typeof fixture>>) => ({ cwd: join(f.root, "escape"), executable })],
  ["dot-dot escape", (f: Awaited<ReturnType<typeof fixture>>) => ({ cwd: `${f.root}/nested/../../root-evil`, executable })],
  ["root vs root-evil prefix", (f: Awaited<ReturnType<typeof fixture>>) => ({ cwd: f.evil, executable })],
  ["relative executable", (f: Awaited<ReturnType<typeof fixture>>) => ({ cwd: f.root, executable: "./python3" })],
  ["executable not on allowlist", (f: Awaited<ReturnType<typeof fixture>>) => ({ cwd: f.root, executable: "/usr/bin/env" })],
] as const;
for (const [name, request] of denials) {
  test(`independent denied request: ${name}`, async () => {
    const f = await fixture();
    let spawnCalls = 0;
    let code: unknown;
    let message = "";
    const diagnostics: string[] = [];
    try {
      try {
        await spawnWithPolicy(f.config, { ...request(f), cols: 80, rows: 24, onData() {} }, {
          env: f.env,
          spawn() { spawnCalls++; return "SHOULD_NOT_SPAWN"; },
          writeDiagnostic(text) { diagnostics.push(text); },
        });
      } catch (error) {
        code = (error as { code?: unknown }).code;
        message = error instanceof Error ? error.message : "not readable";
      }
      expect(code).toBe("POLICY_DENIED");
      expect(spawnCalls).toBe(0);
      expect(message.length > 0).toBe(true);
      expect(diagnostics.some(line => line.includes(f.env.LANG))).toBe(false);
      console.log(`PROBE ${name}: POLICY_DENIED; spawn_calls=${spawnCalls}; readable_error=true; credential_in_diagnostics=false`);
    } finally { await rm(f.base, { recursive: true, force: true }); }
  });
}

test("independent allow reaches canonical spawn once with literal argv", async () => {
  const f = await fixture();
  let spawnCalls = 0;
  const args = ["$(touch SHOULD_NOT_EXIST)", "; literal not shell interpolation"];
  try {
    const result = await spawnWithPolicy(f.config, { cwd: join(f.root, "nested"), executable, args, cols: 80, rows: 24, onData() {} }, {
      env: f.env,
      spawn(options) {
        spawnCalls++;
        expect(options.cwd).toBe(join(f.root, "nested"));
        expect(options.executable).toBe(f.config.approvedExecutables[executable]);
        expect(options.args).toEqual(args);
        return "allowed";
      },
    });
    expect(result).toBe("allowed");
    expect(spawnCalls).toBe(1);
    console.log("PROBE allowed nested cwd/executable: spawn_calls=1; canonical_paths=true; literal_argv=true");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("independent config supplies exact inputs and module rejects before callback", async () => {
  const f = await fixture();
  let callbacks = 0;
  try {
    expect(f.config.approvedRoot).toBe(f.root);
    expect(f.config.approvedExecutables[executable]).toBeDefined();
    expect(f.config.hostname).toBe("127.0.0.1");
    expect(f.config.port).toBe(0);
    expect(f.config.tunnelHostname).toBe("verifier.example.com");
    expect(f.config.tokenEnvVar).toBe("LANG");
    expect(JSON.stringify(f.config).includes(f.env.LANG)).toBe(false);
    let readable = false;
    try {
      await startWithConfig("http", () => { callbacks++; }, { ...f.env, TETHERTERM_APPROVED_ROOT: "relative-root" });
    } catch (error) {
      readable = error instanceof Error && error.message.includes("TETHERTERM_APPROVED_ROOT");
    }
    expect(readable).toBe(true);
    expect(callbacks).toBe(0);
    const stdio = await loadConfig("stdio", {
      PATH: f.env.PATH,
      TETHERTERM_APPROVED_ROOT: f.root,
      TETHERTERM_APPROVED_EXECUTABLES: f.env.TETHERTERM_APPROVED_EXECUTABLES,
    });
    expect(stdio.mode).toBe("stdio");
    console.log("PROBE config module: exact_PRD_inputs=true; invalid_config_start_callback_calls=0; readable_error=true; stdio_without_HTTP_credentials=true");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("independent configuration rejects relative executable paths", async () => {
  const f = await fixture();
  let rejected = false;
  try {
    try { await loadConfig("http", { ...f.env, TETHERTERM_APPROVED_EXECUTABLES: '["./python3"]' }); }
    catch (error) { rejected = error instanceof Error && error.message.length > 0; }
    expect(rejected).toBe(true);
    console.log("PROBE relative executable config ./python3: readable_configuration_rejection=true");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

for (const tokenVar of ["LANG", "TERM"]) {
  test(`independent real PTY child prints environment; token variable ${tokenVar} excluded`, async () => {
    const f = await fixture();
    const credentialNames = ["LC_TOKEN", "LC_API_KEY", "LC_SECRET", "LC_PASSWORD", "LC_AUTH", "Credential_Sentinel", "token", "api_key", "Secret", "Password", "AUTH"];
    const credentialEnv = Object.fromEntries(credentialNames.map(name => [name, secret()]));
    const token = secret();
    const env = { ...f.env, LANG: "C.UTF-8", TERM: "xterm", ...credentialEnv, TETHERTERM_TOKEN_ENV_VAR: tokenVar, [tokenVar]: token };
    const sentinels = [token, ...Object.values(credentialEnv)];
    const config = await loadConfig("http", env);
    let output = "";
    const diagnostics: string[] = [];
    let pty: Awaited<ReturnType<typeof spawnWithPolicy>> | undefined;
    try {
      pty = await spawnWithPolicy(config, {
        executable, cwd: f.root, cols: 80, rows: 24,
        args: ["-c", "import json,os; print(json.dumps({'env':dict(os.environ),'tty':os.isatty(0) and os.isatty(1),'controlling':os.tcgetpgrp(0)==os.getpgrp(),'pid':os.getpid(),'pgid':os.getpgrp(),'sid':os.getsid(0)}),flush=True)"],
        onData(bytes) { output += new TextDecoder().decode(bytes); },
      }, { env, writeDiagnostic(text) { diagnostics.push(text); } });
      const exit = await deadline(pty.child.exited);
      await deadline((async () => {
        while (!output.includes("\n")) { await Bun.sleep(5); }
      })());
      expect(exit).toBe(0);
      const child = JSON.parse(output.trim()) as { env: Record<string, string>; tty: boolean; controlling: boolean; pid: number; pgid: number; sid: number };
      expect(child.tty).toBe(true);
      expect(child.controlling).toBe(true);
      expect(child.pid).toBe(pty.child.pid);
      expect(child.pgid).toBe(child.pid);
      expect(child.sid).toBe(child.pid);
      expect(Object.hasOwn(child.env, tokenVar)).toBe(false);
      for (const name of credentialNames) { expect(Object.hasOwn(child.env, name)).toBe(false); }
      expect(sentinels.some(value => output.includes(value))).toBe(false);
      expect(sentinels.some(value => diagnostics.join("\n").includes(value))).toBe(false);
      console.log(`PROBE real PTY ${tokenVar}: child_exit=0; tty=true; controlling=true; PID=PGID=SID=${child.pid}; child_printed_env=true; child_env_keys=${Object.keys(child.env).sort().join(",")}`);
      console.log(`PROBE real PTY ${tokenVar}: TOKEN/KEY/SECRET/PASSWORD/AUTH_names_absent=true; credential_sentinel_absent=true; configured_token_var_absent=true; token_values_absent=true; diagnostics_values_absent=true`);
    } finally {
      if (pty) {
        if (pty.child.exitCode === null) { try { process.kill(-pty.child.pid, "SIGKILL"); } catch {} }
        await deadline(pty.child.exited);
        pty.terminal.close();
      }
      await rm(f.base, { recursive: true, force: true });
    }
  });
}

test("independent diagnostics redact runtime credential and terminal content on denial/failure", async () => {
  const f = await fixture();
  const credential = secret();
  const terminalContent = secret();
  const diagnostics: string[] = [];
  const writeDiagnostic = (text: string) => diagnostics.push(text);
  let spawnFailure = "";
  try {
    for (const event of ["startup_failed", "policy_denied", "spawn_failed"] as const) { logDiagnostic(event, writeDiagnostic); }
    try {
      await spawnWithPolicy(f.config, { executable, cwd: f.root, args: [credential, terminalContent], rows: 24, cols: 80, onData() {} }, {
        env: { ...f.env, LC_SECRET: credential },
        spawn() { throw new Error(`${credential} ${terminalContent}`); },
        writeDiagnostic,
      });
    } catch (error) { spawnFailure = error instanceof Error ? error.message : ""; }
    try {
      await spawnWithPolicy(f.config, { executable: credential, cwd: f.root, args: [terminalContent], rows: 24, cols: 80, onData() {} }, { env: f.env, writeDiagnostic });
    } catch {}
    const captured = [...diagnostics, spawnFailure].join("\n");
    expect([credential, terminalContent, f.env.LANG].some(value => captured.includes(value))).toBe(false);
    expect(spawnFailure).toBe("Approved terminal could not be started");
    console.log(`PROBE diagnostics: credential_values_absent=true; terminal_content_absent=true; configured_token_absent=true; captured_static_events=${diagnostics.length}`);
    for (const line of diagnostics) { console.log(`CAPTURED_DIAGNOSTIC ${line}`); }
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

for (const caseName of ["missing-required-config", "explicit-invalid-required-config"]) {
  test(`acceptance criterion 3 actual server startup: ${caseName}`, async () => {
    const env: Record<string, string> = { PATH: "/usr/bin:/bin", PORT: "0" };
    if (caseName === "explicit-invalid-required-config") {
      Object.assign(env, {
        TETHERTERM_APPROVED_ROOT: "relative-root",
        TETHERTERM_APPROVED_EXECUTABLES: "[]",
        TETHERTERM_PORT: "-1",
        TETHERTERM_TUNNEL_HOSTNAME: "https://invalid.example/",
        TETHERTERM_TOKEN_ENV_VAR: "MISSING_BEARER",
      });
    }
    const server = Bun.spawn([process.execPath, join(product, "apps/server/src/index.ts")], { cwd: product, env, stderr: "pipe", stdout: "pipe" });
    const reader = server.stderr.getReader();
    let output = "";
    try {
      await deadline((async () => {
        while (!output.includes("TetherTerm listening")) {
          const chunk = await reader.read();
          if (chunk.done) break;
          output += new TextDecoder().decode(chunk.value);
        }
      })());
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        const response = await fetch(`http://127.0.0.1:${match[1]}/healthz`, { signal: AbortSignal.timeout(3000) });
        const body = await response.text();
        console.log(`PROBE actual server ${caseName}: STARTED=true; ephemeral_port=${match[1]}; HTTP_STATUS=${response.status}; health_body=${body}; invalid_config_rejected=false`);
        console.log(`CAPTURED_STARTUP ${output.trim()}`);
      } else {
        console.log(`PROBE actual server ${caseName}: STARTED=false; readable_config_error=${/configuration|APPROVED_ROOT/.test(output)}`);
      }
      expect(match === null, "AC3 requires bad config to prevent actual server startup; listening/HTTP 200 proves missing wiring").toBe(true);
      expect(await deadline(server.exited)).not.toBe(0);
      expect(/configuration|APPROVED_ROOT/.test(output)).toBe(true);
    } finally {
      if (server.exitCode === null) server.kill("SIGTERM");
      await deadline(server.exited);
      await reader.cancel();
      reader.releaseLock();
    }
  }, 10000);
}
