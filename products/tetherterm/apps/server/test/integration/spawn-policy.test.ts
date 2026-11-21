import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { spawnWithPolicy } from "../../src/policy";
import { policyFixture } from "../fixtures/spawn-policy";

const identityPattern = /IDENTITY=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;

test("approved real PTY receives literal argv and no server credentials", async () => {
	const fixture = await policyFixture();
	const config = await loadConfig("http", fixture.env);
	const marker = join(fixture.root, "must-not-exist");
	const literal = `$(touch ${marker})`;
	const diagnostics: string[] = [];
	let output = "";
	const decoder = new TextDecoder();
	let eofCalls = 0;
	const { child, eof, terminal } = await spawnWithPolicy(
		config,
		{
			args: [
				"--noprofile",
				"--norc",
				"-c",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Bash parameter expansion verifies the child's environment, not JavaScript interpolation.
				'test -t 0 && test -t 1 || exit 99; : < /dev/tty || exit 98; printf "IDENTITY="; /usr/bin/ps -o pid=,pgid=,sid=,tpgid= -p $$; test "${CUSTOM_BEARER+x}" != x || exit 90; test "${OPENAI_API_KEY+x}" != x || exit 91; test "${DATABASE_URL+x}" != x || exit 92; test "${NODE_OPTIONS+x}" != x || exit 93; printf \'ARG=%s\nCWD=%s\nNO_CREDENTIALS\n\' "$1" "$PWD"',
				"probe",
				literal,
			],
			cols: 80,
			cwd: join(fixture.root, "inside-link"),
			executable: "bash",
			onData(bytes) {
				output += decoder.decode(bytes, { stream: true });
			},
			onEof() {
				eofCalls += 1;
				output += decoder.decode();
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
		await Promise.race([
			Promise.all([child.exited, eof]),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("policy PTY timed out")),
					5000
				);
			}),
		]);
		expect(child.exitCode).toBe(0);
		expect(child.terminal).toBe(terminal);
		expect(eofCalls).toBe(1);
		expect(output.match(identityPattern)?.slice(1)).toEqual(
			Array.from({ length: 4 }, () => String(child.pid))
		);
		expect(output).toContain("NO_CREDENTIALS\r\n");
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
