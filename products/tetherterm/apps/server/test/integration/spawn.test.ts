import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPty } from "../../src/pty/spawn";

test("native PTY helper forwards explicit args, cwd and env", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-101-spawn-"));
	let output = "";
	const decoder = new TextDecoder();
	const { child, terminal } = spawnPty({
		args: [
			"--noprofile",
			"--norc",
			"-c",
			'test -t 0 && test -t 1 || exit 99; printf \'CWD=%s\\nARG=%s\\nENV=%s\\n\' "$PWD" "$1" "$TETHERTERM_PROBE"',
			"probe",
			"argument with spaces",
		],
		cols: 80,
		cwd,
		env: { PATH: "/usr/bin:/bin", TETHERTERM_PROBE: "nonsecret-probe" },
		executable: "bash",
		onData(bytes) {
			output += decoder.decode(bytes, { stream: true });
		},
		rows: 24,
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const code = await Promise.race([
			child.exited,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("spawn integration timed out")),
					5000
				);
			}),
		]);
		expect(code).toBe(0);
		// Exit can precede the final master-side data event; poll, not a fixed sleep.
		const deadline = Date.now() + 5000;
		while (!output.includes("ENV=nonsecret-probe\r\n")) {
			if (Date.now() >= deadline) {
				throw new Error(`missing PTY output: ${output}`);
			}
			// biome-ignore lint/performance/noAwaitInLoops: Drain the last PTY data event with deadline-bounded polling.
			await Bun.sleep(10);
		}
		expect(output).toContain(`CWD=${cwd}\r\n`);
		expect(output).toContain("ARG=argument with spaces\r\n");
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await child.exited;
		terminal.close();
		await rm(cwd, { force: true, recursive: true });
	}
}, 10_000);
