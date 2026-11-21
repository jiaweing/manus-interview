import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const [, , mode] = process.argv;
if (mode !== "dev") {
	throw new Error(
		"Usage: bun run scripts/run-apps.ts dev (production uses one Bun server)"
	);
}

const root = resolve(import.meta.dir, "..");
const webDir = resolve(root, "apps/web");
const serverDir = resolve(root, "apps/server");
const webRequire = createRequire(resolve(webDir, "package.json"));
const nextCli = resolve(
	dirname(webRequire.resolve("next/package.json")),
	"dist/bin/next"
);
const env = {
	...process.env,
	NEXT_TELEMETRY_DISABLED: "1",
	NODE_ENV: "development",
};
const children = [
	Bun.spawn(
		[
			"bun",
			nextCli,
			"dev",
			"--port",
			process.env.WEB_PORT ?? "3000",
			"--hostname",
			process.env.HOST ?? "127.0.0.1",
		],
		{ cwd: webDir, env, stderr: "inherit", stdout: "inherit" }
	),
	Bun.spawn(["bun", "--hot", "src/index.ts"], {
		cwd: serverDir,
		env,
		stderr: "inherit",
		stdout: "inherit",
	}),
];

let stopping = false;
function stop() {
	if (stopping) {
		return;
	}
	stopping = true;
	for (const child of children) {
		child.kill("SIGTERM");
	}
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const firstExit = await Promise.race(children.map((child) => child.exited));
const interrupted = stopping;
stop();
await Promise.all(children.map((child) => child.exited));
process.exit(interrupted ? 0 : firstExit || 1);
