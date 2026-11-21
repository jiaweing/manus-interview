/**
 * Runs the single-origin HTTPS stack: Next.js on loopback + Bun HTTPS/WSS front.
 *   bun run scripts/https.ts dev     (next dev)
 *   bun run scripts/https.ts start   (next start; requires `bun run build`)
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
	console.error("usage: https.ts <dev|start>");
	process.exit(2);
}

const root = resolve(import.meta.dir, "..");
const certDir = join(root, ".certs");
const cert = process.env.TLS_CERT_FILE ?? join(certDir, "localhost.crt");
const key = process.env.TLS_KEY_FILE ?? join(certDir, "localhost.key");

if (!(existsSync(cert) && existsSync(key))) {
	if (process.env.TLS_CERT_FILE || process.env.TLS_KEY_FILE) {
		console.error("TLS_CERT_FILE / TLS_KEY_FILE point to missing files");
		process.exit(1);
	}
	mkdirSync(certDir, { recursive: true });
	const r = Bun.spawnSync([
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"30",
		"-keyout",
		key,
		"-out",
		cert,
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost,IP:127.0.0.1",
	]);
	if (r.exitCode !== 0) {
		console.error("openssl failed to create the local development certificate");
		process.exit(1);
	}
}

const nodeEnv = mode === "dev" ? "development" : "production";
const env = {
	...process.env,
	NODE_ENV: nodeEnv,
	TLS_CERT_FILE: cert,
	TLS_KEY_FILE: key,
};

const nextPort = process.env.NEXT_INTERNAL_PORT ?? "3001";
const next = Bun.spawn(
	[
		"bun",
		"--bun",
		"run",
		"next",
		mode,
		"--port",
		nextPort,
		"--hostname",
		"127.0.0.1",
	],
	{
		cwd: join(root, "apps/web"),
		env,
		stderr: "inherit",
		stdout: "inherit",
	}
);
const server = Bun.spawn(
	mode === "dev"
		? ["bun", "run", "src/index.ts"]
		: ["bun", "run", "dist/index.js"],
	{ cwd: join(root, "apps/server"), env, stderr: "inherit", stdout: "inherit" }
);

const stop = () => {
	next.kill();
	server.kill();
};
process.on("SIGINT", () => {
	stop();
	process.exit(0);
});
process.on("SIGTERM", () => {
	stop();
	process.exit(0);
});
await Promise.race([next.exited, server.exited]);
stop();
process.exit(1);
