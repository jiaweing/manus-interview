import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { Environment } from "../../src/config";
import { launcherFixture } from "../fixtures/launcher";

const productRoot = new URL("../../../..", import.meta.url).pathname;
const readyPattern = /listening|ready on stdio|http:\/\//i;
const addressPattern = /http:\/\/127\.0\.0\.1:(\d+)/;
const listenerMarker = "TetherTerm test: listening socket requested";
const observer = new URL("../fixtures/observe-listener.ts", import.meta.url)
	.pathname;
let fixture: Awaited<ReturnType<typeof launcherFixture>>;

beforeAll(async () => {
	fixture = await launcherFixture();
});

afterAll(async () => {
	await fixture.cleanup();
});

async function withTimeout<T>(promise: Promise<T>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("configuration startup proof timed out")),
					5000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function launcherCommand(entrypoint: string) {
	// The observer records Bun.serve and delegates to its REAL implementation.
	// It does not prevent a broken launcher from opening a socket; the positive
	// control below checks an actual HTTP response through that same observer.
	return [
		process.execPath,
		"--preload",
		observer,
		join(productRoot, "apps/server/src", entrypoint),
	];
}

type InvalidCase = [string, () => Environment];
const commonCases: InvalidCase[] = [
	[
		"missing required configuration",
		() => ({ CUSTOM_BEARER: fixture.token, PATH: fixture.env.PATH, PORT: "0" }),
	],
	[
		"missing approved root",
		() => ({ ...fixture.env, TETHERTERM_APPROVED_ROOT: undefined }),
	],
	[
		"missing executable allowlist",
		() => ({ ...fixture.env, TETHERTERM_APPROVED_EXECUTABLES: undefined }),
	],
	[
		"invalid relative root containing a credential",
		() => ({ ...fixture.env, TETHERTERM_APPROVED_ROOT: fixture.token }),
	],
	[
		"invalid executable JSON containing a credential",
		() => ({ ...fixture.env, TETHERTERM_APPROVED_EXECUTABLES: fixture.token }),
	],
	[
		"invalid canonical port despite legacy PORT=0",
		() => ({ ...fixture.env, PORT: "0", TETHERTERM_PORT: "-1" }),
	],
	[
		"invalid legacy port alias",
		() => ({ ...fixture.env, PORT: "65536", TETHERTERM_PORT: undefined }),
	],
];
const httpCases: InvalidCase[] = [
	[
		"missing HTTP token and tunnel configuration",
		() => ({
			...fixture.env,
			CUSTOM_BEARER: undefined,
			TETHERTERM_TOKEN_ENV_VAR: undefined,
			TETHERTERM_TUNNEL_HOSTNAME: undefined,
		}),
	],
	[
		"missing configured token",
		() => ({ ...fixture.env, CUSTOM_BEARER: undefined }),
	],
	[
		"invalid bearer value",
		() => ({ ...fixture.env, CUSTOM_BEARER: fixture.token.slice(1) }),
	],
	[
		"invalid tunnel hostname containing a credential",
		() => ({
			...fixture.env,
			TETHERTERM_TUNNEL_HOSTNAME: `https://${fixture.token}.example.com/`,
		}),
	],
];

for (const entrypoint of ["index.ts", "http.ts", "stdio.ts"]) {
	const cases =
		entrypoint === "stdio.ts" ? commonCases : [...commonCases, ...httpCases];
	for (const [label, environment] of cases) {
		test(`${entrypoint}: ${label} exits before listening or stdio connection`, async () => {
			const env = environment();
			const child = Bun.spawn(launcherCommand(entrypoint), {
				cwd: productRoot,
				env,
				stderr: "pipe",
				stdin: "pipe",
				stdout: "pipe",
			});
			const stdout = new Response(child.stdout).text();
			const stderr = new Response(child.stderr).text();
			try {
				// Leave stdin open and queue initialize: a bad stdio launcher must
				// reject config, not connect and return a protocol response first.
				child.stdin.write(
					`${JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: { capabilities: {}, clientInfo: { name: "bad-config-proof", version: "0.1.0" }, protocolVersion: "2025-03-26" } })}\n`
				);
				const [code, output, diagnostics] = await withTimeout(
					Promise.all([child.exited, stdout, stderr])
				);
				expect(code).toBe(1);
				expect(output).toBe("");
				expect(diagnostics).toContain("TetherTerm configuration:");
				expect(diagnostics.length > "TetherTerm configuration:".length).toBe(
					true
				);
				expect(readyPattern.test(diagnostics)).toBe(false);
				// All real entrypoint listeners use Bun.serve; no call means no
				// listening socket, including transient listeners before failure.
				expect(diagnostics.includes(listenerMarker)).toBe(false);
				const captured = output + diagnostics;
				expect(captured.includes(fixture.token)).toBe(false);
				const token = env.CUSTOM_BEARER;
				expect(token ? captured.includes(token) : false).toBe(false);
				console.log(
					`${entrypoint} ${label}: exit=${code} readable_stderr=true listening_socket=false stdout=EMPTY token_in_output=false`
				);
			} finally {
				if (child.exitCode === null) {
					child.kill("SIGKILL");
				}
				await withTimeout(child.exited);
				child.stdin.end();
			}
		}, 10_000);
	}
}

test("listener observer delegates to a real valid-config HTTP launcher socket", async () => {
	const child = Bun.spawn(launcherCommand("index.ts"), {
		cwd: productRoot,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const reader = child.stderr.getReader();
	let diagnostics = "";
	try {
		await withTimeout(
			(async () => {
				while (!addressPattern.test(diagnostics)) {
					// biome-ignore lint/performance/noAwaitInLoops: Read this owned launcher's readiness sequentially.
					const chunk = await reader.read();
					if (chunk.done) {
						throw new Error("socket positive control exited before readiness");
					}
					diagnostics += new TextDecoder().decode(chunk.value);
				}
			})()
		);
		expect(diagnostics).toContain(listenerMarker);
		expect(child.exitCode).toBeNull();
		const address = `http://127.0.0.1:${diagnostics.match(addressPattern)?.[1]}/healthz`;
		const response = await fetch(address, {
			signal: AbortSignal.timeout(3000),
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(diagnostics.includes(fixture.token)).toBe(false);
		child.kill("SIGTERM");
		expect(await withTimeout(child.exited)).toBe(0);
		expect(await withTimeout(new Response(child.stdout).text())).toBe("");
		await expect(
			fetch(address, { signal: AbortSignal.timeout(3000) })
		).rejects.toThrow();
		console.log(
			"listener observer positive_control=real_HTTP_200 shutdown_exit=0 listener_closed=true"
		);
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await withTimeout(child.exited);
		await reader.cancel();
		reader.releaseLock();
	}
}, 10_000);
