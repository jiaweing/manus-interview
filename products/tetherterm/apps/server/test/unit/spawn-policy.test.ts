import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type Environment,
	loadConfig,
	type ServerConfig,
	startWithConfig,
} from "../../src/config";
import { logDiagnostic } from "../../src/diagnostics";
import { ConfigurationError, TerminalError } from "../../src/errors";
import {
	buildChildEnvironment,
	type SpawnRequest,
	spawnWithPolicy,
} from "../../src/policy";
import type { SpawnPtyOptions } from "../../src/pty/spawn";
import { policyFixture } from "../fixtures/spawn-policy";

let fixture: Awaited<ReturnType<typeof policyFixture>>;
let config: ServerConfig;

beforeAll(async () => {
	fixture = await policyFixture();
	config = await loadConfig("http", fixture.env);
});

afterAll(async () => {
	await rm(fixture.base, { force: true, recursive: true });
});

function request(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
	return {
		args: ["--noprofile", "--norc"],
		cols: 80,
		cwd: fixture.root,
		executable: "bash",
		onData() {
			// Unit tests must never allocate a terminal.
		},
		rows: 24,
		...overrides,
	};
}

describe("spawn policy completes before spawn", () => {
	for (const location of ["root", "nested", "inside-link"] as const) {
		test(`approved executable and ${location} cwd reach spawn once`, async () => {
			const cwd =
				location === "inside-link"
					? join(fixture.root, location)
					: fixture[location];
			const spawn = mock((options: SpawnPtyOptions) => options);
			const approved = await spawnWithPolicy(config, request({ cwd }), {
				env: fixture.env,
				spawn,
			});
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(approved.cwd).toBe(
				location === "inside-link" ? fixture.nested : cwd
			);
			expect(approved.executable === config.approvedExecutables.bash).toBe(
				true
			);
			expect(approved.args).toEqual(["--noprofile", "--norc"]);
		});
	}

	const deniedRequests: [string, () => Partial<SpawnRequest>][] = [
		["forbidden executable", () => ({ executable: "python3" })],
		["shell interpolation", () => ({ executable: "bash; echo unsafe" })],
		["prototype executable", () => ({ executable: "toString" })],
		["traversal", () => ({ cwd: `${fixture.root}/../root-other` })],
		["root prefix sibling", () => ({ cwd: fixture.outside })],
		["symlink escape", () => ({ cwd: join(fixture.root, "escape") })],
		[
			"symlink traversal escape",
			() => ({ cwd: `${fixture.root}/inside-link/../..` }),
		],
		["missing cwd", () => ({ cwd: join(fixture.root, "missing") })],
		["relative cwd", () => ({ cwd: "nested" })],
		["file cwd", () => ({ cwd: join(fixture.root, "not-directory") })],
		["NUL argument", () => ({ args: ["bad\0argument"] })],
	];
	for (const [label, overrides] of deniedRequests) {
		test(`${label} returns POLICY_DENIED with zero spawn calls`, async () => {
			const spawn = mock((_options: SpawnPtyOptions) => "must not spawn");
			const diagnostics: string[] = [];
			let failure: unknown;
			try {
				await spawnWithPolicy(config, request(overrides()), {
					env: fixture.env,
					spawn,
					writeDiagnostic: (message) => diagnostics.push(message),
				});
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(TerminalError);
			expect((failure as TerminalError).code).toBe("POLICY_DENIED");
			expect((failure as TerminalError).message.length > 0).toBe(true);
			expect(spawn).toHaveBeenCalledTimes(0);
			expect(diagnostics).toEqual([
				"TetherTerm POLICY_DENIED: terminal request rejected by policy",
			]);
		});
	}

	test("args remain literal, while canonical executable and cwd are passed", async () => {
		const args = ["a b", "; echo unsafe", "$(touch marker)", "*", "--"];
		const spawn = mock((options: SpawnPtyOptions) => options);
		const result = await spawnWithPolicy(
			config,
			request({ args, cwd: `${fixture.nested}/..` }),
			{ env: fixture.env, spawn }
		);
		expect(result.args).toEqual(args);
		expect(result.cwd).toBe(resolve(fixture.root));
		expect(result.executable.startsWith("/")).toBe(true);
	});
});

describe("configuration fails before startup", () => {
	test("exact PRD configuration is loaded without retaining bearer values", () => {
		expect(config.approvedRoot).toBe(fixture.root);
		expect(config.hostname).toBe("127.0.0.1");
		expect(config.port).toBe(0);
		expect(config.tunnelHostname).toBe("approved.example.com");
		expect(config.tokenEnvVar).toBe("CUSTOM_BEARER");
		expect(Object.isFrozen(config.approvedExecutables)).toBe(true);
		expect(JSON.stringify(config).includes(fixture.token)).toBe(false);
	});

	test("stdio does not require any HTTP credentials or tunnel configuration", async () => {
		const stdio = await loadConfig("stdio", {
			...fixture.env,
			CUSTOM_BEARER: undefined,
			TETHERTERM_TOKEN_ENV_VAR: undefined,
			TETHERTERM_TUNNEL_HOSTNAME: undefined,
		});
		expect(stdio.mode).toBe("stdio");
		expect(stdio.tokenEnvVar).toBeUndefined();
		expect(stdio.tunnelHostname).toBeUndefined();
	});

	const invalidInputs: [string, () => Record<string, string | undefined>][] = [
		["missing root", () => ({ TETHERTERM_APPROVED_ROOT: undefined })],
		["relative root", () => ({ TETHERTERM_APPROVED_ROOT: "root" })],
		[
			"missing executables",
			() => ({ TETHERTERM_APPROVED_EXECUTABLES: undefined }),
		],
		[
			"invalid executable JSON",
			() => ({ TETHERTERM_APPROVED_EXECUTABLES: fixture.credential }),
		],
		["empty executables", () => ({ TETHERTERM_APPROVED_EXECUTABLES: "[]" })],
		[
			"relative executable path",
			() => ({ TETHERTERM_APPROVED_EXECUTABLES: '["./bash"]' }),
		],
		[
			"missing executable file",
			() => ({
				TETHERTERM_APPROVED_EXECUTABLES: '["/does-not-exist/tetherterm-103"]',
			}),
		],
		[
			"missing root directory",
			() => ({ TETHERTERM_APPROVED_ROOT: join(fixture.root, "missing") }),
		],
		[
			"file root",
			() => ({ TETHERTERM_APPROVED_ROOT: join(fixture.root, "not-directory") }),
		],
		["invalid port", () => ({ TETHERTERM_PORT: "65536" })],
		["negative port", () => ({ TETHERTERM_PORT: "-1" })],
		["missing hostname", () => ({ TETHERTERM_TUNNEL_HOSTNAME: undefined })],
		[
			"URL instead of hostname",
			() => ({ TETHERTERM_TUNNEL_HOSTNAME: "https://approved.example.com" }),
		],
		[
			"wildcard hostname",
			() => ({ TETHERTERM_TUNNEL_HOSTNAME: "*.example.com" }),
		],
		[
			"hostname includes port",
			() => ({ TETHERTERM_TUNNEL_HOSTNAME: "approved.example.com:443" }),
		],
		["missing token variable", () => ({ TETHERTERM_TOKEN_ENV_VAR: undefined })],
		[
			"invalid token variable name",
			() => ({ TETHERTERM_TOKEN_ENV_VAR: "invalid-name" }),
		],
		["missing bearer", () => ({ CUSTOM_BEARER: undefined })],
		["short bearer", () => ({ CUSTOM_BEARER: "not-a-valid-32-byte-value" })],
	];
	for (const [label, overrides] of invalidInputs) {
		test(`${label} produces a readable failure before startup callback`, async () => {
			const start = mock(() => "must not listen");
			let failure: unknown;
			try {
				await startWithConfig("http", start, {
					...fixture.env,
					...overrides(),
				});
			} catch (error) {
				failure = error;
			}
			expect(start).toHaveBeenCalledTimes(0);
			expect(failure).toBeInstanceOf(ConfigurationError);
			const { message } = failure as ConfigurationError;
			expect(message.startsWith("TetherTerm configuration:")).toBe(true);
			expect(message.includes(fixture.token)).toBe(false);
			expect(message.includes(fixture.credential)).toBe(false);
		});
	}

	test("valid configuration invokes startup once", async () => {
		const start = mock((loaded: ServerConfig) => loaded.hostname);
		expect(await startWithConfig("http", start, fixture.env)).toBe("127.0.0.1");
		expect(start).toHaveBeenCalledTimes(1);
	});
});

describe("environment and diagnostic redaction", () => {
	test("allowlist drops configured token, credentials, addon settings and unknown variables", () => {
		const env: Environment = {
			...fixture.env,
			AWS_ACCESS_KEY_ID: fixture.credential,
			DATABASE_URL: fixture.credential,
			GITHUB_TOKEN: fixture.credential,
			LC_AUTH: fixture.credential,
			LC_PASSWORD: fixture.credential,
			MONITORING_DSN: fixture.credential,
			NODE_OPTIONS: fixture.credential,
			SSH_AUTH_SOCK: fixture.credential,
			UNRECOGNIZED: fixture.credential,
		};
		const child = buildChildEnvironment(env, config.tokenEnvVar);
		expect(Object.keys(child).sort()).toEqual([
			"HOME",
			"LANG",
			"LC_CTYPE",
			"PATH",
			"TERM",
		]);
		expect(child.PATH === env.PATH).toBe(true);
		expect(child.TERM).toBe("xterm-256color");
		expect(JSON.stringify(child).includes(fixture.token)).toBe(false);
		expect(JSON.stringify(child).includes(fixture.credential)).toBe(false);
		expect(env.CUSTOM_BEARER === fixture.token).toBe(true);
	});

	test("configured token variable is excluded even if normally allowlisted", () => {
		const child = buildChildEnvironment(
			{ PATH: "/usr/bin:/bin", TERM: fixture.token },
			"TERM"
		);
		expect(Object.hasOwn(child, "TERM")).toBe(false);
	});

	test("spawn failure and denial logs never include credentials, argv, or terminal content", async () => {
		const diagnostics: string[] = [];
		const capture = (message: string) => diagnostics.push(message);
		const spawn = mock((_options: SpawnPtyOptions) => {
			throw new Error(
				`${fixture.token} ${fixture.credential} terminal-content`
			);
		});
		await expect(
			spawnWithPolicy(config, request({ args: [fixture.credential] }), {
				env: fixture.env,
				spawn,
				writeDiagnostic: capture,
			})
		).rejects.toThrow("Approved terminal could not be started");
		await expect(
			spawnWithPolicy(config, request({ executable: fixture.token }), {
				env: fixture.env,
				spawn,
				writeDiagnostic: capture,
			})
		).rejects.toBeInstanceOf(TerminalError);
		logDiagnostic("startup_failed", capture);
		const output = diagnostics.join("\n");
		expect(output.includes(fixture.token)).toBe(false);
		expect(output.includes(fixture.credential)).toBe(false);
		expect(output.includes("terminal-content")).toBe(false);
		expect(output.includes("POLICY_DENIED")).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
	});
});
