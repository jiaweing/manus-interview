import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { spawnPty } from "../src/pty/spawn";

const timeoutMs = 5000;
const identityPattern = /IDENTITY=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;
const parentPattern = /PARENT=\s*(\d+)\s+(\d+)/;
const grandchildPattern = /GRANDCHILD=(\d+)/;
const whitespacePattern = /\s+/;

async function poll(
	description: string,
	predicate: () => boolean | Promise<boolean>
) {
	const deadline = Date.now() + timeoutMs;
	// biome-ignore lint/performance/noAwaitInLoops: Readiness polling must observe each preceding attempt.
	while (!(await predicate())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out: ${description}`);
		}
		await Bun.sleep(10);
	}
}

async function exited(child: ReturnType<typeof Bun.spawn>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			child.exited,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("PTY child did not exit")),
					timeoutMs
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function procFields(pid: number) {
	const stat = await readFile(`/proc/${pid}/stat`, "utf8");
	return stat
		.slice(stat.lastIndexOf(")") + 2)
		.trim()
		.split(" ");
}

async function hasTerminated(pid: number) {
	try {
		return (await procFields(pid))[0] === "Z";
	} catch (error) {
		const { code } = error as NodeJS.ErrnoException;
		// After signaling, Linux can reap the process between opening and reading
		// stat. ESRCH proves disappearance here, but must fail live-state checks.
		if (code === "ENOENT" || code === "ESRCH") {
			return true;
		}
		throw error;
	}
}

function spawnProbe(executable: string, args: string[]) {
	let output = "";
	let ownGroup = false;
	let eofCalls = 0;
	const decoder = new TextDecoder();
	const { child, eof, terminal } = spawnPty({
		args,
		cols: 80,
		cwd: process.cwd(),
		// Never inherit credentials or shell configuration from the test runner.
		env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
		executable,
		onData(bytes) {
			output += decoder.decode(bytes, { stream: true });
		},
		onEof() {
			eofCalls += 1;
			output += decoder.decode();
		},
		rows: 24,
	});
	expect(child.terminal).toBe(terminal);
	return {
		async assertIdentity() {
			await this.waitFor("READY");
			const match = output.match(identityPattern);
			const parent = output.match(parentPattern);
			expect(match).not.toBeNull();
			expect(parent).not.toBeNull();
			const pid = Number(match?.[1]);
			const pgid = Number(match?.[2]);
			const sid = Number(match?.[3]);
			const foregroundPgid = Number(match?.[4]);
			// Inline Bun spawning owns the controlling session without a wrapper/fork.
			expect(pid).toBe(child.pid);
			expect(pgid).toBe(pid);
			expect(sid).toBe(pid);
			expect(foregroundPgid).toBe(pgid);
			expect(pid).not.toBe(process.pid);
			expect(pgid).not.toBe(Number(parent?.[1]));
			expect(sid).not.toBe(Number(parent?.[2]));
			ownGroup = true;
			return pid;
		},
		child,
		async close() {
			if (ownGroup) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
						throw error;
					}
				}
			} else if (child.exitCode === null) {
				// Safe fallback during setup failure: never target an unverified group.
				child.kill("SIGKILL");
			}
			await exited(child);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					eof,
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(
							() => reject(new Error("native PTY EOF did not arrive")),
							timeoutMs
						);
					}),
				]);
				expect(eofCalls).toBe(1);
			} finally {
				clearTimeout(timer);
				terminal.close();
			}
			expect(eofCalls).toBe(1);
		},
		output: () => output,
		terminal,
		waitFor: (text: string) =>
			poll(`PTY output ${JSON.stringify(text)}; ${output}`, () =>
				output.includes(text)
			),
	};
}

const bashIdentity = String.raw`
test -t 0 && test -t 1 || exit 99
printf 'TTY=true STDIN_TTY=true STDOUT_TTY=true\n'
printf 'IDENTITY='
ps -o pid=,pgid=,sid=,tpgid= -p $$
printf 'PARENT='
ps -o pgid=,sid= -p $PPID
# Opening /dev/tty also proves a controlling terminal, not merely isatty.
: < /dev/tty || exit 98
`;

const pythonIdentity = `
import os, signal, sys
assert os.isatty(0) and os.isatty(1)
assert os.tcgetpgrp(0) == os.getpgrp()
assert os.getsid(0) == os.getpid()
print("TTY=true STDIN_TTY=true STDOUT_TTY=true")
print("IDENTITY=%s %s %s %s" % (os.getpid(), os.getpgrp(), os.getsid(0), os.tcgetpgrp(0)))
print("PARENT=%s %s" % (os.getpgid(os.getppid()), os.getsid(os.getppid())))
`;

const bashArgs = (script: string) => ["--noprofile", "--norc", "-c", script];
const pythonArgs = (script: string) => ["-u", "-c", script];

// No timed exit: the reported PID stays alive in read until the test releases
// it, then exec preserves that PID as a sleep that only exits when signaled.
const sleepGrandchild = String.raw`
bash --noprofile --norc -c '
printf "GRANDCHILD=%s\n" "$$"
IFS= read -r release < /dev/tty
test "$release" = release-grandchild || exit 97
exec sleep infinity
' &
wait
`;

test("bash: controlling PTY, echo, resize/SIGWINCH, foreground CTRL_C and exit 7", async () => {
	const probe = spawnProbe(
		"bash",
		bashArgs(`${bashIdentity}
trap 'printf "SIGWINCH_SIZE="; stty size' WINCH
printf 'INITIAL_SIZE='; stty size
printf '\\033[31mANSI_PRESERVED\\033[0m\\nREADY\\n'
IFS= read -r input
printf 'RESPONSE:<%s>\\n' "$input"
# read may be interrupted by WINCH; retry without a timing assumption.
while ! IFS= read -r request; do :; done
printf 'RESIZED_SIZE='; stty size
# Keep this harness alive to report sleep's SIGINT; exec children reset traps.
trap ':' INT
printf 'SLEEP_READY\\n'
sleep infinity
printf 'INTERRUPTED=%s\\n' "$?"
exit 7
`)
	);
	try {
		const pid = await probe.assertIdentity();
		expect(probe.output()).toContain("TTY=true STDIN_TTY=true STDOUT_TTY=true");
		expect(probe.output()).toContain("INITIAL_SIZE=24 80");
		expect(probe.output()).toContain("\u001b[31mANSI_PRESERVED\u001b[0m");
		expect(probe.terminal.write("native-pty-input\n")).toBe(17);
		await probe.waitFor("RESPONSE:<native-pty-input>");
		expect(probe.output()).toContain("\r\nnative-pty-input\r\n");
		probe.terminal.resize(132, 43);
		// Bash can defer a trapped signal until its blocking read completes.
		probe.terminal.write("report-size\n");
		await probe.waitFor("SIGWINCH_SIZE=43 132");
		await probe.waitFor("RESIZED_SIZE=43 132");
		await probe.waitFor("SLEEP_READY");
		// Check the foreground command actually started before sending CTRL_C.
		await poll(
			"foreground sleep infinity running in the PTY group",
			async () => {
				const children = await readFile(
					`/proc/${pid}/task/${pid}/children`,
					"utf8"
				);
				const matches = await Promise.all(
					children
						.trim()
						.split(whitespacePattern)
						.filter(Boolean)
						.map(async (descendant) => {
							const fields = await procFields(Number(descendant));
							if (fields[0] === "Z" || Number(fields[2]) !== pid) {
								return false;
							}
							const command = await readFile(
								`/proc/${descendant}/cmdline`,
								"utf8"
							);
							return command === "sleep\u0000infinity\u0000";
						})
				);
				return matches.some(Boolean);
			}
		);
		probe.terminal.write(new Uint8Array([3]));
		await probe.waitFor("INTERRUPTED=130");
		expect(await exited(probe.child)).toBe(7);
		expect(probe.child.exitCode).toBe(7);
		console.log(
			`bash PID=PGID=SID=TPGID=${pid} TTY=true ECHO=true SIGWINCH=43x132 CTRL_C=130 EXIT=7`
		);
	} finally {
		await probe.close();
	}
}, 20_000);

test("python3: controlling PTY, echo, resize/SIGWINCH, CTRL_C KeyboardInterrupt and exit 7", async () => {
	const probe = spawnProbe(
		"python3",
		pythonArgs(`${pythonIdentity}
print("INITIAL_SIZE=%s %s" % (os.get_terminal_size(0).lines, os.get_terminal_size(0).columns))
def resized(signum, frame):
    size = os.get_terminal_size(0)
    print("SIGWINCH_SIZE=%s %s" % (size.lines, size.columns))
signal.signal(signal.SIGWINCH, resized)
print("READY")
line = input()
print("PYTHON_RESPONSE:<%s>" % line)
try:
    print("INTERRUPT_READY")
    input()
except KeyboardInterrupt:
    print("KEYBOARD_INTERRUPT=true")
sys.exit(7)
`)
	);
	try {
		const pid = await probe.assertIdentity();
		expect(probe.output()).toContain("TTY=true STDIN_TTY=true STDOUT_TTY=true");
		expect(probe.output()).toContain("INITIAL_SIZE=24 80");
		probe.terminal.write("python-input\n");
		await probe.waitFor("PYTHON_RESPONSE:<python-input>");
		expect(probe.output()).toContain("\r\npython-input\r\n");
		await probe.waitFor("INTERRUPT_READY");
		probe.terminal.resize(101, 37);
		await probe.waitFor("SIGWINCH_SIZE=37 101");
		probe.terminal.write(new Uint8Array([3]));
		await probe.waitFor("KEYBOARD_INTERRUPT=true");
		expect(await exited(probe.child)).toBe(7);
		expect(probe.child.exitCode).toBe(7);
		console.log(
			`python3 PID=PGID=SID=TPGID=${pid} TTY=true ECHO=true SIGWINCH=37x101 CTRL_C=KeyboardInterrupt EXIT=7`
		);
	} finally {
		await probe.close();
	}
}, 20_000);

for (const executable of ["bash", "python3"]) {
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		test(`${executable}: ${signal} to isolated group terminates child and sleep grandchild, not Bun`, async () => {
			const script =
				executable === "bash"
					? `${bashIdentity}\nprintf 'READY\\n'\n${sleepGrandchild}`
					: `${pythonIdentity}
import subprocess
child = subprocess.Popen(["bash", "--noprofile", "--norc", "-c", ${JSON.stringify(sleepGrandchild)}])
print("READY")
child.wait()
`;
			const probe = spawnProbe(
				executable,
				executable === "bash" ? bashArgs(script) : pythonArgs(script)
			);
			try {
				const pid = await probe.assertIdentity();
				await poll("grandchild pid reported", () =>
					grandchildPattern.test(probe.output())
				);
				const grandchild = Number(probe.output().match(grandchildPattern)?.[1]);
				// The grandchild cannot exit its input gate before these live reads.
				const before = await procFields(grandchild);
				expect(before).not.toBeNull();
				expect(Number(before?.[2])).toBe(pid);
				expect(Number(before?.[3])).toBe(pid);
				expect(before?.[0]).not.toBe("Z");
				expect(probe.child.exitCode).toBeNull();
				probe.terminal.write("release-grandchild\n");
				await poll(
					"released grandchild execed sleep in the PTY group",
					async () => {
						const command = await readFile(
							`/proc/${grandchild}/cmdline`,
							"utf8"
						);
						return command === "sleep\u0000infinity\u0000";
					}
				);
				process.kill(-pid, signal);
				await exited(probe.child);
				expect(probe.child.signalCode).toBe(signal);
				await poll(
					"grandchild terminated (gone or zombie awaiting init reap)",
					() => hasTerminated(grandchild)
				);
				expect(process.kill(process.pid, 0)).toBe(true);
				console.log(
					`${executable} GROUP=${pid} GRANDCHILD=${grandchild} ${signal}=TREE_TERMINATED BUN_ALIVE=true`
				);
			} finally {
				await probe.close();
			}
		}, 20_000);
	}
}
