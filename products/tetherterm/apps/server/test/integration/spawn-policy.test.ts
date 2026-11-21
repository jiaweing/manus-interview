import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { spawnWithPolicy } from "../../src/policy";
import { policyFixture } from "../fixtures/spawn-policy";

test("approved real PTY receives literal argv and no server credentials", async () => {
	const fixture = await policyFixture();
	const config = await loadConfig("http", fixture.env);
	const marker = join(fixture.root, "must-not-exist");
	const literal = `$(touch ${marker})`;
	const diagnostics: string[] = [];
	let output = "";
	const decoder = new TextDecoder();
	const { child, terminal } = await spawnWithPolicy(
		config,
		{
			args: [
				"--noprofile",
				"--norc",
				"-c",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Bash parameter expansion verifies the child's environment, not JavaScript interpolation.
				'test -t 0 && test -t 1 || exit 99; test "${CUSTOM_BEARER+x}" != x || exit 90; test "${OPENAI_API_KEY+x}" != x || exit 91; test "${DATABASE_URL+x}" != x || exit 92; test "${NODE_OPTIONS+x}" != x || exit 93; printf \'ARG=%s\\nCWD=%s\\nNO_CREDENTIALS\\n\' "$1" "$PWD"',
				"probe",
				literal,
			],
			cols: 80,
			cwd: join(fixture.root, "inside-link"),
			executable: "bash",
			onData(bytes) {
				output += decoder.decode(bytes, { stream: true });
			},
			rows: 24,
		},
		{
			env: {
				...fixture.env,
				DATABASE_URL: fixture.credential,
				NODE_OPTIONS: fixture.credential,
			},
			writeDiagnostic: (message) => diagnostics.push(message),
		}
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const exitCode = await Promise.race([
			child.exited,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("policy PTY timed out")),
					5000
				);
			}),
		]);
		expect(exitCode).toBe(0);
		const deadline = Date.now() + 5000;
		while (!output.includes("NO_CREDENTIALS\r\n")) {
			if (Date.now() >= deadline) {
				throw new Error("Missing final policy PTY output");
			}
			// biome-ignore lint/performance/noAwaitInLoops: Deadline-bounded polling drains the last PTY event after exit.
			await Bun.sleep(10);
		}
		expect(output.includes(fixture.token)).toBe(false);
		expect(output.includes(fixture.credential)).toBe(false);
		expect(output).toContain(`ARG=${literal}\r\n`);
		expect(output).toContain(`CWD=${fixture.nested}\r\n`);
		expect(existsSync(marker)).toBe(false);
		expect(diagnostics).toEqual([]);
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null) {
			process.kill(-child.pid, "SIGKILL");
		}
		await child.exited;
		terminal.close();
		await rm(fixture.base, { force: true, recursive: true });
	}
}, 10_000);
