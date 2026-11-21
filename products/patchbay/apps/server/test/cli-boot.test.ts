import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { main } from "../src/cli";
import { EXIT_CODES } from "../src/cli/errors";
import { createKernel } from "../src/kernel";

const root = resolve(import.meta.dir, "../../..");
const unknownError =
	'ERROR [UNKNOWN_COMMAND]: Unknown command. Type "help" for available commands.';
let home: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "patchbay-boot-"));
});

afterEach(async () => {
	await rm(home, { force: true, recursive: true });
});

async function boot(
	input = "",
	environment: Record<string, string> = {},
	guardNetwork = false
) {
	const cmd = guardNetwork
		? [
				process.execPath,
				"--no-env-file",
				"--preload",
				join(root, "apps/server/test/fixtures/no-services.ts"),
				join(root, "apps/server/src/cli.ts"),
			]
		: [process.execPath, "run", "patchbay"];
	const child = Bun.spawn(cmd, {
		cwd: root,
		env: {
			HOME: home,
			NO_COLOR: "1",
			NODE_ENV: "test",
			PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
			...environment,
		},
		stderr: "pipe",
		stdin: "pipe",
		stdout: "pipe",
		timeout: 3000,
	});
	child.stdin.write(input);
	child.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stderr, stdout };
}

function memoryIO(input: Readable) {
	const output = new PassThrough();
	const error = new PassThrough();
	let stdout = "";
	let stderr = "";
	output.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	error.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	return {
		options: { error, home, input, output, platform: "linux", terminal: false },
		read: () => ({ stderr, stdout }),
	};
}

describe("empty foreground CLI", () => {
	test("kernel starts with zero tools and zero providers", () => {
		const first = createKernel();
		const second = createKernel();
		expect(first.tools.size).toBe(0);
		expect(first.providers.size).toBe(0);
		expect(first.tools).not.toBe(second.tools);
		expect(first.providers).not.toBe(second.providers);
	});

	test("root Bun script boots with a fresh HOME and exits on immediate EOF", async () => {
		const result = await boot();
		expect(result.exitCode).toBe(EXIT_CODES.OK);
		expect(result.stdout).toContain("Patchbay ready: 0 tools, 0 providers.");
		expect(result.stderr).not.toContain("ERROR [");
		expect(await readdir(home)).toEqual([]);
	});

	test("unknown commands use a stable error across runs and leave help usable", async () => {
		const first = await boot("missing\nmissing\nhelp\n");
		const second = await boot("missing\nmissing\nhelp\n");
		for (const result of [first, second]) {
			expect(result.exitCode).toBe(EXIT_CODES.OK);
			expect(
				result.stderr.split("\n").filter((line) => line === unknownError)
			).toHaveLength(2);
			expect(result.stdout).toContain("Commands: help, exit");
		}
	});

	test("EOF dispatches a final line without a newline and never hangs", async () => {
		const result = await boot("help");
		expect(result.exitCode).toBe(EXIT_CODES.OK);
		expect(result.stdout).toContain("Commands: help, exit");
	});

	test("blank lines and CRLF are accepted; explicit exit ends the session", async () => {
		const result = await boot("\r\n  help  \r\nexit\r\nmissing\r\n");
		expect(result.exitCode).toBe(EXIT_CODES.OK);
		expect(result.stdout).toContain("Commands: help, exit");
		expect(result.stderr).not.toContain("UNKNOWN_COMMAND");
	});

	test("NO_COLOR=1 has no ANSI escapes, even for hostile unknown command text", async () => {
		const ansiEscape = String.fromCharCode(27);
		const result = await boot(`${ansiEscape}[31mFAKE_SECRET\nhelp\n`);
		expect(result.exitCode).toBe(EXIT_CODES.OK);
		expect(result.stdout + result.stderr).not.toContain(ansiEscape);
		expect(result.stdout + result.stderr).not.toContain("FAKE_SECRET");
		expect(result.stderr).toContain(unknownError);
	});

	test("boots without credentials, database, HTTP listener, or any network access", async () => {
		const result = await boot(
			"help\n",
			{
				BETTER_AUTH_SECRET: "",
				DATABASE_URL: "invalid-dormant-database",
				GOOGLE_GENERATIVE_AI_API_KEY: "",
				OPENROUTER_API_KEY: "",
			},
			true
		);
		expect(result.exitCode).toBe(EXIT_CODES.OK);
		expect(result.stdout).toContain("Patchbay ready: 0 tools, 0 providers.");
		expect(result.stderr).toBe("");
	});

	test("invalid HOME has a stable startup error and nonzero exit", async () => {
		const file = join(home, "not-a-directory");
		await writeFile(file, "unrelated");
		const results = await Promise.all(
			["", "relative", file, join(home, "missing")].map((invalidHome) =>
				boot("help\n", { HOME: invalidHome })
			)
		);
		for (const result of results) {
			expect(result.exitCode).toBe(EXIT_CODES.STARTUP);
			expect(result.stderr).toContain(
				"ERROR [STARTUP_FAILED]: HOME must name an existing absolute directory."
			);
			expect(result.stdout).not.toContain("Patchbay ready");
		}
	});

	test("unsupported platform uses the documented startup exit", async () => {
		const io = memoryIO(Readable.from([]));
		const code = await main({ ...io.options, platform: "darwin" });
		expect(code).toBe(EXIT_CODES.STARTUP);
		expect(io.read().stderr).toContain("ERROR [UNSUPPORTED_PLATFORM]");
		expect(io.read().stdout).toBe("");
	});

	test("fatal input failure returns exit 2 with a redacted stable error", async () => {
		const input = new Readable({
			read() {
				this.destroy(new Error("FAKE_FATAL_SECRET"));
			},
		});
		const io = memoryIO(input);
		const code = await main(io.options);
		expect(code).toBe(EXIT_CODES.FATAL);
		expect(io.read().stderr).toBe(
			"ERROR [SESSION_FAILED]: The foreground session failed.\n"
		);
		expect(io.read().stderr).not.toContain("FAKE_FATAL_SECRET");
	});
});
