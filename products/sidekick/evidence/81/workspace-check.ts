import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { file, serve, spawn, write } from "bun";
import { createProxyApp } from "../../apps/server/src/agent/app";

// Finite verification fixture only, not durable proxy hosting or a model test.
const root = resolve(import.meta.dir, "../..");
const temporary = await mkdtemp(join(tmpdir(), "sidekick81-tls-"));
const certificate = join(temporary, "cert.pem");
const key = join(temporary, "key.pem");
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		key,
		"-out",
		certificate,
		"-days",
		"1",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost",
	],
	{ stdio: "ignore" }
);
const demoToken = `dummy-${crypto.randomUUID()}`;
const app = createProxyApp({
	demoToken,
	maxBodyBytes: 131_072,
	port: 8787,
	publicUrl: "https://localhost",
	rateLimitMaxRequests: 60,
	rateLimitWindowMs: 60_000,
});
const server = serve({
	fetch: app.fetch,
	hostname: "localhost",
	port: 0,
	tls: { cert: file(certificate), key: file(key) },
});
const env = {
	...process.env,
	NODE_EXTRA_CA_CERTS: certificate,
	SIDEKICK_DEMO_TOKEN: demoToken,
	SIDEKICK_PROXY_URL: `https://localhost:${server.port}`,
	WXT_SIDEKICK_PROXY_URL: "https://proxy.example.com",
};
try {
	for (const [name, command] of [
		["full-suite", ["bun", "test"]],
		["secrets", ["bun", "run", "verify:secrets"]],
	] as const) {
		console.log(
			`Running ${name} against disposable authenticated HTTPS; no provider key or model call`
		);
		const output = file(resolve(import.meta.dir, `${name}.log`));
		// biome-ignore lint/performance/noAwaitInLoops: Each finite check truncates its own log before execution; the secret scanner follows the completed tests.
		await write(output, "");
		const child = spawn([...command], {
			cwd: root,
			env,
			stderr: output,
			stdout: output,
		});
		const exit = await child.exited;
		console.log(`${name} exit=${exit}`);
		console.log((await output.text()).split("\n").slice(-14).join("\n"));
		if (exit !== 0) {
			process.exitCode = 1;
		}
	}
} finally {
	server.stop(true);
	await rm(temporary, { force: true, recursive: true });
}
