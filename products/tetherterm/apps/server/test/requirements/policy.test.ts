import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import {
	JSONRPCMessageSchema,
	LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import { type Environment, loadConfig } from "../../src/config";
import { TerminalError } from "../../src/errors";
import { type SpawnPtyOptions, spawnPty } from "../../src/pty/spawn";
import {
	type CreateSessionRequest,
	MAX_LIVE_SESSIONS,
	SessionManager,
} from "../../src/sessions/manager";
import type { PtyHandle } from "../../src/sessions/session";
import { policyFixture } from "../fixtures/spawn-policy";

// R17 is a guardrail, not isolation: approved interpreters retain host permissions.
// Deliberately detached jobs are outside the cleanup guarantee; none are created here.
// Until #112 wires terminal tools, SessionManager.create is the highest create path.
const productRoot = new URL("../../../..", import.meta.url).pathname;
const addressPattern = /http:\/\/127\.0\.0\.1:(\d+)\/mcp/;
const linePattern = /\r?\n/;
const whitespacePattern = /\s+/;
const ownPids = new Set<number>();
const cleanups: (() => Promise<void>)[] = [];

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("R17 fixture timed out")),
					5000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function until(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error("R17 observation timed out");
		}
		// biome-ignore lint/performance/noAwaitInLoops: Poll this owned fixture under a deadline, not a fixed readiness sleep.
		await Bun.sleep(5);
	}
}

async function stopPty(pty: PtyHandle): Promise<void> {
	try {
		if (pty.child.exitCode === null) {
			try {
				process.kill(-pty.child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
				// Group already disappeared; fallback targets only this owned child.
				pty.child.kill("SIGKILL");
			}
		}
		await bounded(pty.child.exited);
	} finally {
		pty.terminal.close();
	}
}

function captureLogs() {
	const logs: string[] = [];
	const spies = (["error", "warn", "info", "log", "debug"] as const).map(
		(method) =>
			spyOn(console, method).mockImplementation((...args: unknown[]) => {
				logs.push(args.map(String).join(" "));
			})
	);
	return {
		logs,
		restore() {
			for (const spy of spies) {
				spy.mockRestore();
			}
		},
	};
}

async function fixture(tokenEnvVar = "CUSTOM_BEARER") {
	const paths = await policyFixture();
	cleanups.push(() => rm(paths.base, { force: true, recursive: true }));
	const names = [
		"APP_TOKEN",
		"APP_SECRET",
		"APP_PASSWORD",
		"APP_PASSWD",
		"APP_CREDENTIAL",
		"APP_AUTH",
		"APP_COOKIE",
		"APP_SESSION",
		"APP_KEY",
		"LC_AUTH",
		"LC_PASSWORD",
		"LC_SECRET",
		"DATABASE_URL",
		"OPENAI_API_KEY",
		"NODE_OPTIONS",
		"BASH_ENV",
	];
	const credentials = Object.fromEntries(
		names.map((name) => [name, randomBytes(32).toString("hex")])
	);
	const env: Environment = {
		...paths.env,
		...credentials,
		[tokenEnvVar]: paths.token,
		TETHERTERM_TOKEN_ENV_VAR: tokenEnvVar,
	};
	const config = await loadConfig("http", env);
	await symlink(
		config.approvedExecutables.bash as string,
		join(paths.root, "bash")
	);
	const ptys: PtyHandle[] = [];
	const observations: SpawnPtyOptions[] = [];
	const outputs: string[] = [];
	const control: { failSpawn: boolean; spawnCalls: number } = {
		failSpawn: false,
		spawnCalls: 0,
	};
	cleanups.push(async () => {
		await Promise.all(ptys.map(stopPty));
	});
	const manager = new SessionManager(config, {
		env,
		spawn(options) {
			control.spawnCalls += 1;
			if (control.failSpawn) {
				throw new Error(
					`${paths.token} ${Object.values(credentials).join(" ")}`
				);
			}
			const index = outputs.length;
			outputs.push("");
			const decoder = new TextDecoder();
			const pty = spawnPty({
				...options,
				onData(bytes) {
					outputs[index] += decoder.decode(bytes, { stream: true });
					// Observe without replacing the manager's real output callback.
					options.onData(bytes);
				},
			});
			ptys.push(pty);
			observations.push(options);
			ownPids.add(pty.child.pid);
			return pty;
		},
	});
	return {
		...paths,
		config,
		control,
		credentials,
		env,
		manager,
		observations,
		outputs,
		ptys,
		sentinels: [paths.token, paths.credential, ...Object.values(credentials)],
		tokenEnvVar,
	};
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function request(f: Fixture, overrides: Partial<CreateSessionRequest> = {}) {
	return {
		args: [
			"--noprofile",
			"--norc",
			"-c",
			'test -t 0 && test -t 1 || exit 99; printf "R17_LIVE\\n"; exec /usr/bin/sleep 60',
		],
		cwd: f.root,
		executable: "bash",
		...overrides,
	};
}

function assertNoSentinels(text: string, f: Fixture) {
	// Boolean assertions keep runtime-generated credentials out of failure output.
	for (const sentinel of f.sentinels) {
		expect(text.includes(sentinel)).toBe(false);
	}
}

async function directChildren(): Promise<number[]> {
	// Linux records children per spawning thread, so inspect every task, not just
	// the main thread. This is independent of the manager's injected spawn counter.
	const taskRoot = `/proc/${process.pid}/task`;
	const children = await Promise.all(
		(await readdir(taskRoot)).map(async (task) => {
			try {
				return await readFile(join(taskRoot, task, "children"), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return ""; // A Bun worker thread can finish during observation.
				}
				throw error;
			}
		})
	);
	return [
		...new Set(
			children
				.join(" ")
				.trim()
				.split(whitespacePattern)
				.filter(Boolean)
				.map(Number)
		),
	].sort((a, b) => a - b);
}

afterEach(async () => {
	// LIFO: await native processes and close terminals before deleting their cwd.
	for (const cleanup of cleanups.splice(0).reverse()) {
		// biome-ignore lint/performance/noAwaitInLoops: Cleanup ordering is necessary for owned PTYs and directories.
		await cleanup();
	}
});

afterAll(async () => {
	if (ownPids.size === 0) {
		return;
	}
	const child = Bun.spawn(
		["ps", "-o", "pid=,stat=,comm=", "-p", [...ownPids].join(",")],
		{ stderr: "pipe", stdout: "pipe" }
	);
	try {
		const output = await bounded(new Response(child.stdout).text());
		expect([0, 1]).toContain(await bounded(child.exited));
		for (const line of output.trim().split("\n").filter(Boolean)) {
			expect(line.trim().split(whitespacePattern)[1]?.startsWith("Z")).toBe(
				true
			);
		}
		console.log(`R17 OWN_PID_PS checked=${ownPids.size} live_processes=0`);
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await bounded(child.exited);
	}
});

describe("R17 denied manager creates precede every native spawn", () => {
	const cases: [string, (f: Fixture) => Partial<CreateSessionRequest>][] = [
		["non-allowlisted executable", () => ({ executable: "/usr/bin/env" })],
		["non-allowlisted command name", () => ({ executable: "env" })],
		[
			"relative executable that exists inside root",
			() => ({ executable: "./bash" }),
		],
		["traversal outside root", (f) => ({ cwd: `${f.root}/../root-other` })],
		["symlink escape", (f) => ({ cwd: join(f.root, "escape") })],
		["prefix-sharing sibling", (f) => ({ cwd: f.outside })],
		["symlink plus traversal", (f) => ({ cwd: `${f.root}/inside-link/../..` })],
		["relative cwd", () => ({ cwd: "nested" })],
		["missing cwd", (f) => ({ cwd: join(f.root, "missing") })],
		["file cwd", (f) => ({ cwd: join(f.root, "not-directory") })],
		["credential-bearing executable", (f) => ({ executable: f.token })],
		["credential-bearing cwd", (f) => ({ cwd: join(f.outside, f.credential) })],
	];
	for (const [label, overrides] of cases) {
		test(`${label}: POLICY_DENIED, zero spawns/processes/records, capacity preserved`, async () => {
			const f = await fixture();
			const before = await directChildren();
			const marker = join(f.root, "denied-child-must-not-run");
			const nativeSpawn = spyOn(Bun, "spawn"); // Transparent spy, not a fake PTY.
			const capture = captureLogs();
			try {
				let failure: unknown;
				try {
					await f.manager.create(
						request(f, {
							args: [
								"--noprofile",
								"--norc",
								"-c",
								'printf spawned > "$1"; exec /usr/bin/sleep 60',
								"probe",
								marker,
							],
							...overrides(f),
						})
					);
				} catch (error) {
					failure = error;
				}
				expect(failure).toBeInstanceOf(TerminalError);
				expect((failure as TerminalError).code).toBe("POLICY_DENIED");
				expect(f.control.spawnCalls).toBe(0);
				expect(nativeSpawn).toHaveBeenCalledTimes(0);
				expect(f.ptys).toHaveLength(0);
				expect(f.manager.list()).toEqual({ sessions: [] });
				expect(await directChildren()).toEqual(before);
				expect(existsSync(marker)).toBe(false);
				assertNoSentinels(capture.logs.join("\n") + String(failure), f);
				expect(capture.logs).toEqual([
					"TetherTerm POLICY_DENIED: terminal request rejected by policy",
				]);
			} finally {
				nativeSpawn.mockRestore();
				capture.restore();
			}
			// Exercise all four real live slots, rather than reading private counters.
			const created = await Promise.all(
				Array.from({ length: MAX_LIVE_SESSIONS }, () =>
					f.manager.create(request(f))
				)
			);
			await until(() =>
				f.outputs.every((output) => output.includes("R17_LIVE"))
			);
			expect(created).toHaveLength(4);
			expect(f.control.spawnCalls).toBe(4);
			expect(f.ptys.every(({ child }) => child.exitCode === null)).toBe(true);
			expect(f.manager.list().sessions).toHaveLength(4);
			console.log(
				`R17 ${label}: denied_spawn=0 new_session=0 new_process=0 available_slots=4`
			);
		}, 15_000);
	}
});

for (const location of ["root", "nested", "inside-link"] as const) {
	test(`R17 allowed command and ${location} cwd reach a real PTY with canonical metadata`, async () => {
		const f = await fixture();
		const cwd =
			location === "inside-link" ? join(f.root, location) : f[location];
		const created = await f.manager.create(request(f, { cwd }));
		await until(() => Boolean(f.outputs[0]?.includes("R17_LIVE")));
		expect(f.control.spawnCalls).toBe(1);
		expect(f.manager.status(created.sessionId).cwd).toBe(
			location === "inside-link" ? f.nested : cwd
		);
		expect(f.manager.status(created.sessionId).executable).toBe(
			f.config.approvedExecutables.bash as string
		);
		expect(f.ptys[0]?.child.exitCode).toBeNull();
	});
}

for (const tokenEnvVar of ["CUSTOM_BEARER", "LANG", "TERM"]) {
	test(`R17 real PTY env excludes credentials and configured ${tokenEnvVar}; diagnostics stay clean`, async () => {
		const f = await fixture(tokenEnvVar);
		const parentBefore = JSON.stringify(f.env);
		const capture = captureLogs();
		try {
			const created = await f.manager.create(
				request(f, {
					args: [
						"--noprofile",
						"--norc",
						"-c",
						'test -t 0 && test -t 1 || exit 99; printf "__ENV_START__\\n"; /usr/bin/env -0; printf "\\n__ENV_END__\\n"',
					],
					cwd: join(f.root, "inside-link"),
				})
			);
			const session = f.manager.get(created.sessionId);
			expect(await bounded(session.pty.child.exited)).toBe(0);
			await until(() => Boolean(f.outputs[0]?.includes("__ENV_END__")));
			const output = f.outputs[0] ?? "";
			assertNoSentinels(output, f);
			const envText = output
				.split("__ENV_START__\r\n")[1]
				?.split("\r\n__ENV_END__")[0];
			expect(envText === undefined).toBe(false);
			const names = (envText ?? "")
				.split("\0")
				.filter(Boolean)
				.map((entry) => entry.split("=")[0]);
			for (const name of [...Object.keys(f.credentials), tokenEnvVar]) {
				expect(names.includes(name)).toBe(false);
			}
			expect(names.includes("PATH")).toBe(true); // Nonvacuous env capture.
			expect(names.includes("HOME")).toBe(true);
			expect(output.includes(`HOME=${f.root}\0`)).toBe(true);
			expect(JSON.stringify(f.env) === parentBefore).toBe(true);
			expect(capture.logs.length).toBe(0);
			// Redaction is exercised on actual manager failure/denial paths as well.
			f.control.failSpawn = true;
			let failure: unknown;
			try {
				await f.manager.create(request(f));
			} catch (error) {
				failure = error;
			}
			assertNoSentinels(String(failure), f);
			expect((failure as Error).message).toBe(
				"Approved terminal could not be started"
			);
			await expect(
				f.manager.create(request(f, { executable: f.token }))
			).rejects.toMatchObject({ code: "POLICY_DENIED" });
			assertNoSentinels(
				capture.logs.join("\n") + String(failure) + JSON.stringify(f.config),
				f
			);
			expect(capture.logs).toEqual([
				"TetherTerm: approved terminal could not be started",
				"TetherTerm POLICY_DENIED: terminal request rejected by policy",
			]);
		} finally {
			capture.restore();
		}
		console.log(
			`R17 env ${tokenEnvVar}: real_TTY=true credential_names=ABSENT sentinel_matches=0 diagnostic_matches=0`
		);
	}, 15_000);
}

test("R17 credentials deliberately echoed by a PTY stay in memory, never application logs", async () => {
	const f = await fixture();
	const capture = captureLogs();
	try {
		const created = await f.manager.create(
			request(f, {
				args: [
					"--noprofile",
					"--norc",
					"-c",
					'test -t 0 && test -t 1 || exit 99; printf "%s\\nR17_ECHO_END\\n" "$1"',
					"probe",
					f.token,
				],
			})
		);
		expect(
			await bounded(f.manager.get(created.sessionId).pty.child.exited)
		).toBe(0);
		await until(() => Boolean(f.outputs[0]?.includes("R17_ECHO_END")));
		expect(f.outputs[0]?.includes(f.token)).toBe(true);
		expect(capture.logs.length).toBe(0);
		assertNoSentinels(capture.logs.join("\n"), f);
	} finally {
		capture.restore();
	}
});

function captureStream(stream: ReadableStream<Uint8Array>) {
	let text = "";
	const done = (async () => {
		const decoder = new TextDecoder();
		for await (const bytes of stream) {
			text += decoder.decode(bytes, { stream: true });
		}
		text += decoder.decode();
		return text;
	})();
	return { done, text: () => text };
}

function launch(entrypoint: string, env: Environment) {
	const child = Bun.spawn(
		[process.execPath, join(productRoot, "apps/server/src", entrypoint)],
		{
			cwd: productRoot,
			env,
			stderr: "pipe",
			stdin: "pipe",
			stdout: "pipe",
		}
	);
	ownPids.add(child.pid);
	cleanups.push(async () => {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await bounded(child.exited);
		child.stdin.end();
	});
	return {
		child,
		stderr: captureStream(child.stderr),
		stdout: captureStream(child.stdout),
	};
}

for (const entrypoint of ["http.ts", "stdio.ts"]) {
	test(`R17 actual ${entrypoint} startup failure excludes credentials from all application/addon output`, async () => {
		const f = await fixture();
		const probe = launch(entrypoint, {
			...f.env,
			TETHERTERM_APPROVED_EXECUTABLES: f.credential,
		});
		const [code, stdout, stderr] = await bounded(
			Promise.all([probe.child.exited, probe.stdout.done, probe.stderr.done])
		);
		expect(code).toBe(1);
		assertNoSentinels(stdout + stderr, f);
		expect(stdout).toBe("");
		expect(stderr).toContain("TetherTerm configuration:");
	});
}

test("R17 actual stdio launcher protocol and startup diagnostics exclude credentials/addon settings", async () => {
	const f = await fixture();
	const probe = launch("stdio.ts", f.env);
	probe.child.stdin.write(
		serializeMessage({
			id: 1,
			jsonrpc: "2.0",
			method: "initialize",
			params: {
				capabilities: {},
				clientInfo: { name: "r17-proof", version: "0.1.0" },
				protocolVersion: LATEST_PROTOCOL_VERSION,
			},
		})
	);
	await until(() => probe.stdout.text().includes("\n"));
	probe.child.stdin.write(
		serializeMessage({ jsonrpc: "2.0", method: "notifications/initialized" })
	);
	probe.child.stdin.write(
		serializeMessage({ id: 2, jsonrpc: "2.0", method: "tools/list" })
	);
	await until(() => probe.stdout.text().trim().split(linePattern).length >= 2);
	probe.child.stdin.end();
	const [code, stdout, stderr] = await bounded(
		Promise.all([probe.child.exited, probe.stdout.done, probe.stderr.done])
	);
	expect(code).toBe(0);
	assertNoSentinels(stdout + stderr, f);
	const messages = stdout
		.trim()
		.split(linePattern)
		.map((line) => JSONRPCMessageSchema.parse(JSON.parse(line)));
	expect(messages).toHaveLength(2);
	expect(messages[1]).toMatchObject({
		id: 2,
		result: { tools: expect.any(Array) },
	});
	expect(stderr).toContain("TetherTerm MCP ready on stdio");
});

test("R17 actual authenticated HTTP launcher and SDK discovery exclude credentials from diagnostics", async () => {
	const f = await fixture();
	const probe = launch("http.ts", f.env);
	const client = new Client({ name: "r17-proof", version: "0.1.0" });
	try {
		await until(() => addressPattern.test(probe.stderr.text()));
		const port = Number(probe.stderr.text().match(addressPattern)?.[1]);
		expect(port).toBeGreaterThan(0);
		await bounded(
			client.connect(
				new StreamableHTTPClientTransport(
					new URL(`http://127.0.0.1:${port}/mcp`),
					{
						requestInit: { headers: { Authorization: `Bearer ${f.token}` } },
					}
				)
			)
		);
		expect(await bounded(client.listTools())).toMatchObject({
			tools: expect.any(Array),
		});
		await bounded(client.close());
		probe.child.kill("SIGTERM");
		expect(await bounded(probe.child.exited)).toBe(0);
		const [stdout, stderr] = await bounded(
			Promise.all([probe.stdout.done, probe.stderr.done])
		);
		assertNoSentinels(stdout + stderr, f);
		expect(stdout).toBe("");
		expect(stderr).toContain("TetherTerm MCP listening on");
	} finally {
		await bounded(client.close());
	}
}, 15_000);
