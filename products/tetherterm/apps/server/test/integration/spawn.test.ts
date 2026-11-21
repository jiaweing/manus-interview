import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPty } from "../../src/pty/spawn";

const identityPattern = /IDENTITY=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;

test("inline native PTY forwards literal args, cwd and env without setsid and owns its controlling group", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-107-spawn-"));
	let output = "";
	let eofCalls = 0;
	const decoder = new TextDecoder();
	const args = [
		"--noprofile",
		"--norc",
		"-c",
		'test -t 0 && test -t 1 || exit 99; : < /dev/tty || exit 98; printf "IDENTITY="; /usr/bin/ps -o pid=,pgid=,sid=,tpgid= -p $$; printf \'CWD=%s\\nARG=%s\\nENV=%s\\n\' "$PWD" "$1" "$TETHERTERM_PROBE"',
		"probe",
		"argument with spaces",
	];
	const nativeSpawn = spyOn(Bun, "spawn");
	let pty: ReturnType<typeof spawnPty> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		expect(Bun.which("setsid", { cwd, PATH: cwd })).toBeNull();
		pty = spawnPty({
			args,
			cols: 80,
			cwd,
			env: { PATH: cwd, TETHERTERM_PROBE: "nonsecret-probe" },
			executable: "/bin/bash",
			onData(bytes) {
				output += decoder.decode(bytes, { stream: true });
			},
			onEof() {
				eofCalls += 1;
				output += decoder.decode();
			},
			rows: 24,
		});
		expect(nativeSpawn).toHaveBeenCalledTimes(1);
		expect(nativeSpawn.mock.calls[0]?.[0]).toEqual(["/bin/bash", ...args]);
		expect(nativeSpawn.mock.calls[0]?.[1]?.terminal).not.toBeInstanceOf(
			Bun.Terminal
		);
		expect(pty.child.terminal).toBe(pty.terminal);
		await Promise.race([
			Promise.all([pty.child.exited, pty.eof]),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("spawn integration timed out")),
					5000
				);
			}),
		]);
		expect(pty.child.exitCode).toBe(0);
		expect(output.match(identityPattern)?.slice(1)).toEqual(
			Array.from({ length: 4 }, () => String(pty?.child.pid))
		);
		expect(output).toContain(`CWD=${cwd}\r\n`);
		expect(output).toContain("ARG=argument with spaces\r\n");
		expect(output).toContain("ENV=nonsecret-probe\r\n");
		expect(eofCalls).toBe(1);
		expect(process.kill(process.pid, 0)).toBe(true);
	} finally {
		nativeSpawn.mockRestore();
		clearTimeout(timer);
		if (pty) {
			if (pty.child.exitCode === null) {
				pty.child.kill("SIGKILL");
			}
			await pty.child.exited;
			pty.terminal.close();
		}
		await rm(cwd, { force: true, recursive: true });
	}
}, 10_000);
