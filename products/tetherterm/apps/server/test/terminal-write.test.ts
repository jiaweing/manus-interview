import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import { loadConfig } from "../src/config";
import { spawnPty } from "../src/pty/spawn";
import {
	encodeInput,
	MAX_INPUT_BYTES,
	type TerminalKey,
	type WriteSessionRequest,
	writeSessionInput,
} from "../src/sessions/input";
import { SessionManager } from "../src/sessions/manager";
import type { PtyHandle, Session } from "../src/sessions/session";

const encoder = new TextEncoder();
const whitespacePattern = /\s+/;
const ownPids = new Set<number>();
const fixtures: { pty: PtyHandle; root: string }[] = [];
const vocabulary: { bytes: number[]; key: TerminalKey }[] = [
	{ bytes: [13], key: "ENTER" },
	{ bytes: [9], key: "TAB" },
	{ bytes: [27], key: "ESC" },
	{ bytes: [127], key: "BACKSPACE" },
	{ bytes: [27, 91, 65], key: "ARROW_UP" },
	{ bytes: [27, 91, 66], key: "ARROW_DOWN" },
	{ bytes: [27, 91, 68], key: "ARROW_LEFT" },
	{ bytes: [27, 91, 67], key: "ARROW_RIGHT" },
	{ bytes: [3], key: "CTRL_C" },
	{ bytes: [4], key: "CTRL_D" },
];

function fake(write?: (bytes: Uint8Array) => number) {
	const log: number[][] = [];
	const session: Session = {
		createdAt: 0,
		cwd: "/fixture",
		dimensions: { cols: 80, rows: 24 },
		executable: "/fixture/bash",
		exitCode: null,
		id: crypto.randomUUID(),
		pty: {
			child: { exitCode: null },
			terminal: {
				closed: false,
				write(bytes: Uint8Array) {
					log.push([...bytes]);
					return write?.(bytes) ?? bytes.byteLength;
				},
			},
		} as unknown as PtyHandle,
		receivedBytes: 0,
		runtimeDeadline: 1000,
		signal: null,
		state: "running",
	};
	return {
		log,
		session,
		write: (input: Omit<WriteSessionRequest, "sessionId">) =>
			writeSessionInput(session, { ...input, sessionId: session.id }),
	};
}

for (const { key, bytes } of vocabulary) {
	test(`fake PTY: ${key} writes its exact defined byte sequence`, async () => {
		const f = fake();
		expect(await f.write({ keys: [key] })).toEqual({
			acceptedBytes: bytes.length,
			state: "running",
		});
		expect(f.log).toEqual([bytes]);
	});
}

test("fake PTY: text preserves UTF-8, counts bytes, and supports explicit empty input", async () => {
	const f = fake();
	const text = "hello 世界🙂\n";
	expect(await f.write({ text })).toEqual({
		acceptedBytes: encoder.encode(text).byteLength,
		state: "running",
	});
	expect(await f.write({ text: "" })).toMatchObject({ acceptedBytes: 0 });
	expect(await f.write({ keys: [] })).toMatchObject({ acceptedBytes: 0 });
	expect(f.log).toEqual([[...encoder.encode(text)], [], []]);
});

test("fake PTY: both/neither, unsupported keys and invalid types write zero bytes", async () => {
	const f = fake();
	for (const input of [
		{},
		{ keys: ["ENTER"], text: "a" },
		{ keys: [], text: "" },
		{ text: null },
		{ text: 1 },
		{ keys: "ENTER" },
		{ keys: ["F1"] },
		{ keys: ["enter"] },
		{ keys: ["ENTER", "DELETE"] },
	]) {
		// biome-ignore lint/performance/noAwaitInLoops: Verify each rejected request leaves the byte log unchanged.
		await expect(
			f.write(input as Omit<WriteSessionRequest, "sessionId">)
		).rejects.toBeInstanceOf(ZodError);
		expect(f.log).toEqual([]);
	}
});

test("fake PTY: 16384-byte text/key boundaries and multibyte overflow are exact", async () => {
	const f = fake();
	const text = "🙂".repeat(MAX_INPUT_BYTES / 4);
	expect(await f.write({ text })).toMatchObject({
		acceptedBytes: MAX_INPUT_BYTES,
	});
	expect(
		await f.write({ keys: new Array<TerminalKey>(MAX_INPUT_BYTES).fill("TAB") })
	).toMatchObject({ acceptedBytes: MAX_INPUT_BYTES });
	const acceptedLog = f.log.slice();
	for (const input of [
		{ text: "a".repeat(MAX_INPUT_BYTES + 1) },
		{ text: `${text}a` },
		{ keys: new Array<TerminalKey>(MAX_INPUT_BYTES + 1).fill("TAB") },
		{
			keys: new Array<TerminalKey>(Math.floor(MAX_INPUT_BYTES / 3) + 1).fill(
				"ARROW_UP"
			),
		},
	]) {
		// biome-ignore lint/performance/noAwaitInLoops: Boundary rejections are individually checked for zero additional writes.
		await expect(f.write(input)).rejects.toMatchObject({ code: "LIMIT" });
		expect(f.log).toEqual(acceptedLog);
	}
});

test("fake PTY: concurrent requests preserve submission order and snapshot keys", async () => {
	const f = fake();
	const keys: TerminalKey[] = ["ARROW_LEFT", "ENTER"];
	const promises = [
		f.write({ text: "first" }),
		f.write({ keys }),
		f.write({ text: "世界" }),
	];
	keys[0] = "CTRL_C";
	await Promise.all(promises);
	expect(f.log).toEqual([
		[...encoder.encode("first")],
		[27, 91, 68, 13],
		[...encoder.encode("世界")],
	]);
});

test("fake PTY: short acceptance is reported without suffix resend or duplicate retry", async () => {
	const f = fake(() => 2);
	expect(await f.write({ text: "abcdef" })).toEqual({
		acceptedBytes: 2,
		state: "running",
	});
	expect(f.log).toEqual([[...encoder.encode("abcdef")]]);
});

test("fake PTY: uncertain error is sanitized, never retried, and does not poison queue", async () => {
	let calls = 0;
	const f = fake((bytes) => {
		calls += 1;
		if (calls === 1) {
			throw new Error("do not expose submitted terminal content");
		}
		return bytes.byteLength;
	});
	const first = f.write({ text: "first" });
	const second = f.write({ text: "second" });
	await expect(first).rejects.toThrow(
		"acceptance is uncertain; it was not retried"
	);
	expect(await second).toMatchObject({ acceptedBytes: 6 });
	expect(calls).toBe(2);
	expect(f.log).toEqual([
		[...encoder.encode("first")],
		[...encoder.encode("second")],
	]);
});

for (const state of ["terminating", "exited"] as const) {
	test(`fake PTY: ${state} rejects immediately and rejects already queued requests`, async () => {
		const f = fake();
		const queued = f.write({ text: "queued" });
		f.session.state = state;
		await expect(queued).rejects.toMatchObject({ code: "NOT_RUNNING" });
		await expect(f.write({ keys: ["ENTER"] })).rejects.toMatchObject({
			code: "NOT_RUNNING",
		});
		expect(f.log).toEqual([]);
	});
}

test("fake PTY: closed handle or actual exited child rejects despite stale running state", async () => {
	for (const property of ["terminal", "child"] as const) {
		const f = fake();
		if (property === "terminal") {
			Object.defineProperty(f.session.pty.terminal, "closed", { value: true });
		} else {
			Object.defineProperty(f.session.pty.child, "exitCode", { value: 0 });
		}
		// biome-ignore lint/performance/noAwaitInLoops: Exercise both stale-state safeguards independently.
		await expect(f.write({ text: "no" })).rejects.toMatchObject({
			code: "NOT_RUNNING",
		});
		expect(f.log).toEqual([]);
	}
});

test("fake PTY: sessions have independent queues", async () => {
	const first = fake();
	const second = fake();
	const results = await Promise.all([
		first.write({ text: "a" }),
		second.write({ text: "b" }),
		first.write({ text: "c" }),
	]);
	expect(results.map(({ acceptedBytes }) => acceptedBytes)).toEqual([1, 1, 1]);
	expect(first.log).toEqual([[97], [99]]);
	expect(second.log).toEqual([[98]]);
});

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("PTY fixture timed out")),
					5000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function poll(
	description: string,
	predicate: () => boolean | Promise<boolean>
) {
	const deadline = Date.now() + 5000;
	// biome-ignore lint/performance/noAwaitInLoops: Observe actual child/output readiness, not a fixed sleep.
	while (!(await predicate())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out: ${description}`);
		}
		await Bun.sleep(5);
	}
}

async function real(executable: string, args: string[]) {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-108-input-"));
	const env = {
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: '["bash","python3","cat"]',
		TETHERTERM_APPROVED_ROOT: root,
	};
	let output = "";
	const decoder = new TextDecoder();
	let handle: PtyHandle | undefined;
	try {
		const manager = new SessionManager(await loadConfig("stdio", env), {
			env,
			spawn(options) {
				handle = spawnPty({
					...options,
					onData(bytes) {
						output += decoder.decode(bytes, { stream: true });
						options.onData(bytes);
					},
				});
				ownPids.add(handle.child.pid);
				fixtures.push({ pty: handle, root });
				return handle;
			},
		});
		const { sessionId } = await manager.create({ args, cwd: root, executable });
		return {
			manager,
			output: () => output,
			pty: manager.get(sessionId).pty,
			sessionId,
			waitFor: (text: string) =>
				poll(`output ${JSON.stringify(text)}; ${output}`, () =>
					output.includes(text)
				),
			write: (input: Omit<WriteSessionRequest, "sessionId">) =>
				manager.write({ ...input, sessionId }),
		};
	} catch (error) {
		if (!handle) {
			await rm(root, { force: true, recursive: true });
		}
		throw error;
	}
}

const bashArgs = (script: string) => ["--noprofile", "--norc", "-c", script];

async function procLive(pid: number) {
	try {
		const stat = await readFile(`/proc/${pid}/stat`, "utf8");
		return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map(async ({ pty, root }) => {
			try {
				// Clean ordinary descendants even if their session leader already exited.
				try {
					process.kill(-pty.child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
						throw error;
					}
					// During setup failure setsid may not yet have established its group.
					if (pty.child.exitCode === null) {
						pty.child.kill("SIGKILL");
					}
				}
				await bounded(pty.child.exited);
			} finally {
				pty.terminal.close();
				await rm(root, { force: true, recursive: true });
			}
		})
	);
});

afterAll(async () => {
	if (ownPids.size === 0) {
		return;
	}
	const child = Bun.spawn(
		["ps", "-o", "pid=,stat=,comm=", "-p", [...ownPids].join(",")],
		{
			stderr: "pipe",
			stdout: "pipe",
		}
	);
	try {
		const output = await bounded(new Response(child.stdout).text());
		expect([0, 1]).toContain(await bounded(child.exited));
		console.log(`WRITE_OWN_PID_PS checked=${[...ownPids].join(",")}`);
		console.log(
			output.trim() || "WRITE_OWN_PID_PS: no recorded process remains"
		);
		for (const line of output.trim().split("\n").filter(Boolean)) {
			expect(line.trim().split(whitespacePattern)[1]?.startsWith("Z")).toBe(
				true
			);
		}
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await bounded(child.exited);
	}
});

test("real Bash: answer read confirmation and hidden-input prompts using text and ENTER", async () => {
	const f = await real(
		"bash",
		bashArgs(String.raw`
		printf 'CONFIRM:'
		IFS= read -r answer
		printf '\nCONFIRMED:<%s>\n' "$answer"
		printf 'HIDDEN_INPUT:'
		IFS= read -r -s answer
		printf '\nHIDDEN_LENGTH:%s\n' "${"$"}{#answer}"
	`)
	);
	await f.waitFor("CONFIRM:");
	expect(await f.write({ text: "yes 世界" })).toMatchObject({
		acceptedBytes: encoder.encode("yes 世界").byteLength,
	});
	await f.write({ keys: ["ENTER"] });
	await f.waitFor("CONFIRMED:<yes 世界>");
	await f.waitFor("HIDDEN_INPUT:");
	await f.write({ text: "synthetic" });
	await f.write({ keys: ["ENTER"] });
	await f.waitFor("HIDDEN_LENGTH:9");
	expect(f.output()).not.toContain("synthetic");
	expect(await bounded(f.pty.child.exited)).toBe(0);
});

test("real Python REPL: UTF-8 text and ENTER evaluate a command; CTRL_D exits", async () => {
	const f = await real("python3", ["-q", "-u", "-i"]);
	await f.waitFor(">>> ");
	const text = 'print("世界🙂", 6 * 7)';
	expect(await f.write({ text })).toMatchObject({
		acceptedBytes: encoder.encode(text).byteLength,
	});
	await f.write({ keys: ["ENTER"] });
	await f.waitFor("世界🙂 42");
	await f.write({ keys: ["CTRL_D"] });
	expect(await bounded(f.pty.child.exited)).toBe(0);
});

test("real cat: text/ENTER echo and CTRL_D EOF exit; exited writes return NOT_RUNNING", async () => {
	const f = await real(
		"bash",
		bashArgs("stty -echo; printf 'READY\\n'; exec cat")
	);
	await f.waitFor("READY");
	await f.write({ text: "cat 世界" });
	await f.write({ keys: ["ENTER"] });
	await f.waitFor("cat 世界\r\n");
	await f.write({ keys: ["CTRL_D"] });
	expect(await bounded(f.pty.child.exited)).toBe(0);
	await expect(f.write({ text: "after exit" })).rejects.toMatchObject({
		code: "NOT_RUNNING",
	});
	await expect(
		f.manager.write({ sessionId: crypto.randomUUID(), text: "unknown" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("real cat -v: arrows, ESC and TAB preserve their bytes", async () => {
	const f = await real(
		"bash",
		bashArgs("stty raw -echo; printf 'READY\\n'; exec cat -v")
	);
	await f.waitFor("READY");
	await f.write({
		keys: ["ARROW_UP", "ARROW_DOWN", "ARROW_LEFT", "ARROW_RIGHT", "ESC", "TAB"],
	});
	await f.waitFor("^[[A^[[B^[[D^[[C^[\t");
});

test("real od: every key produces the defined raw PTY byte sequence", async () => {
	const expected = vocabulary.flatMap(({ bytes }) => bytes);
	const f = await real(
		"bash",
		bashArgs(
			`stty raw -echo; printf 'READY\\n'; od -An -v -tx1 -N ${expected.length}; printf '\\nDONE\\n'`
		)
	);
	await f.waitFor("READY");
	expect(
		await f.write({ keys: vocabulary.map(({ key }) => key) })
	).toMatchObject({ acceptedBytes: expected.length });
	await f.waitFor("DONE");
	const hex = f
		.output()
		.split("READY\n")[1]
		?.split("DONE")[0]
		?.trim()
		.split(whitespacePattern);
	expect(hex).toEqual(
		expected.map((byte) => byte.toString(16).padStart(2, "0"))
	);
	expect(await bounded(f.pty.child.exited)).toBe(0);
});

test("real Bash: CTRL_C interrupts foreground sleep without killing the server", async () => {
	const f = await real(
		"bash",
		bashArgs(
			"trap ':' INT; printf 'READY\\n'; sleep 60; printf 'INTERRUPTED=%s\\n' \"$?\""
		)
	);
	await f.waitFor("READY");
	let descendant = 0;
	await poll("foreground sleep started", async () => {
		const children = (
			await readFile(
				`/proc/${f.pty.child.pid}/task/${f.pty.child.pid}/children`,
				"utf8"
			)
		)
			.trim()
			.split(whitespacePattern)
			.filter(Boolean);
		const matches = await Promise.all(
			children.map(async (pid) => {
				const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
				return command === "sleep\u000060\u0000" ? Number(pid) : 0;
			})
		);
		descendant = matches.find(Boolean) ?? 0;
		if (descendant) {
			ownPids.add(descendant);
		}
		return descendant !== 0;
	});
	expect(await f.write({ keys: ["CTRL_C"] })).toMatchObject({
		acceptedBytes: 1,
	});
	await f.waitFor("INTERRUPTED=130");
	expect(await bounded(f.pty.child.exited)).toBe(0);
	await poll(
		"interrupted descendant is dead",
		async () => !(await procLive(descendant))
	);
	expect(process.pid).toBeGreaterThan(0);
});

const byteReader = (total: number, delayed = false) => [
	"-u",
	"-c",
	`
import os, tty, time, hashlib, select
tty.setraw(0)
print("READY", flush=True)
${delayed ? "time.sleep(0.2)" : ""}
data = bytearray()
while len(data) < ${total}:
    chunk = os.read(0, min(4096, ${total} - len(data)))
    if not chunk: raise RuntimeError("unexpected EOF")
    data.extend(chunk)
# Detect a duplicated final submission/suffix, not merely the expected prefix.
while select.select([0], [], [], 0.05)[0]:
    chunk = os.read(0, 65536)
    if not chunk: break
    data.extend(chunk)
print("COUNT=%s SHA256=%s" % (len(data), hashlib.sha256(data).hexdigest()), flush=True)
	`,
];

test("real PTY: exact 16 KiB Unicode submission survives backpressure; over-cap adds no bytes", async () => {
	const text = "🙂".repeat(MAX_INPUT_BYTES / 4);
	const f = await real("python3", byteReader(MAX_INPUT_BYTES, true));
	await f.waitFor("READY");
	await expect(f.write({ text: `${text}a` })).rejects.toMatchObject({
		code: "LIMIT",
	});
	await expect(
		f.write({ text: "a".repeat(MAX_INPUT_BYTES + 1) })
	).rejects.toMatchObject({ code: "LIMIT" });
	await expect(
		f.write({ keys: ["ENTER"], text: "bad" })
	).rejects.toBeInstanceOf(ZodError);
	await expect(f.write({})).rejects.toBeInstanceOf(ZodError);
	expect(await f.write({ text })).toEqual({
		acceptedBytes: MAX_INPUT_BYTES,
		state: "running",
	});
	await f.waitFor(
		`COUNT=${MAX_INPUT_BYTES} SHA256=${Bun.SHA256.hash(encoder.encode(text), "hex")}`
	);
	expect(await bounded(f.pty.child.exited)).toBe(0);
});

test("real PTY: concurrent near-cap writes arrive in order without interleaving or duplicates", async () => {
	const texts = [
		"A".repeat(MAX_INPUT_BYTES),
		"世".repeat(Math.floor(MAX_INPUT_BYTES / 3)),
		"B".repeat(MAX_INPUT_BYTES),
	];
	const combined = encoder.encode(texts.join(""));
	const f = await real("python3", byteReader(combined.byteLength, true));
	await f.waitFor("READY");
	const results = await Promise.all(texts.map((text) => f.write({ text })));
	expect(results.map(({ acceptedBytes }) => acceptedBytes)).toEqual(
		texts.map((text) => encoder.encode(text).byteLength)
	);
	await f.waitFor(
		`COUNT=${combined.byteLength} SHA256=${Bun.SHA256.hash(combined, "hex")}`
	);
	expect(await bounded(f.pty.child.exited)).toBe(0);
});

test("encoder can be reused by adapters without allocating a PTY", () => {
	expect([
		...encodeInput({ keys: ["ESC", "ENTER"], sessionId: "fixture" }),
	]).toEqual([27, 13]);
});
