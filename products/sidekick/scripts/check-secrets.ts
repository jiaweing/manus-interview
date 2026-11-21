import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "bun";

const token = process.env.SIDEKICK_DEMO_TOKEN;
if (!token) {
	throw new Error(
		"Secret scan requires SIDEKICK_DEMO_TOKEN supplied privately"
	);
}
const secrets = [token, process.env.OPENROUTER_API_KEY].filter(
	(value): value is string => Boolean(value)
);
const buildSentinels = [
	"DUMMY_BUILD_TOKEN_NOT_SECRET",
	"DUMMY_PROVIDER_KEY_NOT_SECRET",
	"LIVE_SENSITIVE_SENTINEL_NOT_SECRET",
];
const paths = spawnSync(["git", "ls-files", "-z", "--", "."]);
if (paths.exitCode !== 0) {
	throw new Error("Secret scan could not enumerate tracked product files");
}
const tracked = new TextDecoder()
	.decode(paths.stdout)
	.split("\0")
	.filter(Boolean);
if (tracked.some((path) => path.split("/").at(-1) === ".env")) {
	throw new Error("Secret scan FAILED: an environment file is tracked");
}

function collect(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? collect(path) : [path];
	});
}

function scan(pathsToScan: string[], forbidden: string[]): void {
	for (const path of pathsToScan) {
		const content = readFileSync(path);
		if (forbidden.some((value) => content.includes(Buffer.from(value)))) {
			// Never print the matching content or secret.
			throw new Error(`Secret scan FAILED: sensitive value found in ${path}`);
		}
	}
}

scan(tracked, secrets);
const output = collect("apps/extension/.output/chrome-mv3");
const logs = collect("evidence/tests").filter((path) => path.endsWith(".log"));
scan([...output, ...logs], [...secrets, ...buildSentinels]);
console.info(
	`Secret scan passed: ${tracked.length} tracked product files, ${output.length} extension artifacts, ${logs.length} evidence logs; no values printed.`
);
