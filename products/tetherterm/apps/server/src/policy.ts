import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import type { Environment, ServerConfig } from "./config";
import { logDiagnostic } from "./diagnostics";
import { TerminalError } from "./errors";
import { type SpawnPtyOptions, spawnPty } from "./pty/spawn";

const requestSchema = z.object({
	args: z
		.array(z.string().refine((value) => !value.includes("\0")))
		.default([]),
	cwd: z.string().min(1).refine(isAbsolute),
	executable: z
		.string()
		.min(1)
		.refine((value) => !value.includes("\0")),
});

export interface SpawnRequest {
	args?: string[];
	cols: number;
	cwd: string;
	executable: string;
	onData: (bytes: Uint8Array) => void;
	onEof?: () => void;
	rows: number;
}

const SAFE_NAMES = new Set([
	"COLORTERM",
	"HOME",
	"LANG",
	"LANGUAGE",
	"LOGNAME",
	"PATH",
	"SHELL",
	"TERM",
	"TMPDIR",
	"TZ",
	"USER",
]);
const CREDENTIAL_NAME =
	/token|secret|password|passwd|credential|auth|cookie|session|key/i;
const LOCALE_NAME = /^LC_[A-Z_]+$/;

/** An allowlist, not a copy of process.env followed by a few deletions. */
export function buildChildEnvironment(
	env: Environment,
	tokenEnvVar?: string
): Record<string, string> {
	const child: Record<string, string> = Object.create(null);
	for (const [name, value] of Object.entries(env)) {
		if (
			value === undefined ||
			name.toUpperCase() === tokenEnvVar?.toUpperCase() ||
			CREDENTIAL_NAME.test(name)
		) {
			continue;
		}
		if (SAFE_NAMES.has(name) || LOCALE_NAME.test(name)) {
			child[name] = value;
		}
	}
	if (tokenEnvVar?.toUpperCase() !== "TERM") {
		child.TERM ??= "xterm-256color";
	}
	return child;
}

function denied(message: string): never {
	throw new TerminalError("POLICY_DENIED", message);
}

export async function validateSpawnPolicy(
	config: ServerConfig,
	request: Pick<SpawnRequest, "args" | "cwd" | "executable">
): Promise<{ args: string[]; cwd: string; executable: string }> {
	const parsed = requestSchema.safeParse(request);
	if (!parsed.success) {
		return denied(
			"Executable, arguments, and cwd must be valid literal values"
		);
	}
	if (!Object.hasOwn(config.approvedExecutables, parsed.data.executable)) {
		return denied("Executable is not approved");
	}
	const executable = config.approvedExecutables[parsed.data.executable];
	if (!executable) {
		return denied("Executable is not approved");
	}

	let cwd: string;
	try {
		cwd = await realpath(parsed.data.cwd);
		if (!(await stat(cwd)).isDirectory()) {
			return denied("Working directory must be an existing directory");
		}
	} catch {
		return denied("Working directory must be an existing directory");
	}
	const pathFromRoot = relative(config.approvedRoot, cwd);
	if (
		isAbsolute(pathFromRoot) ||
		pathFromRoot === ".." ||
		pathFromRoot.startsWith(`..${sep}`)
	) {
		return denied("Working directory is outside the approved root");
	}
	return { args: parsed.data.args, cwd, executable };
}

/** The only high-level spawn boundary; callers cannot supply a child env. */
export async function spawnWithPolicy<T = ReturnType<typeof spawnPty>>(
	config: ServerConfig,
	request: SpawnRequest,
	options: {
		env?: Environment;
		spawn?: (options: SpawnPtyOptions) => T;
		writeDiagnostic?: (message: string) => void;
	} = {}
): Promise<T> {
	let approved: Awaited<ReturnType<typeof validateSpawnPolicy>>;
	try {
		approved = await validateSpawnPolicy(config, request);
	} catch (error) {
		logDiagnostic("policy_denied", options.writeDiagnostic);
		throw error;
	}
	const spawn = options.spawn ?? (spawnPty as (options: SpawnPtyOptions) => T);
	try {
		return spawn({
			...approved,
			cols: request.cols,
			env: buildChildEnvironment(
				options.env ?? process.env,
				config.tokenEnvVar
			),
			onData: request.onData,
			onEof: request.onEof,
			rows: request.rows,
		});
	} catch {
		logDiagnostic("spawn_failed", options.writeDiagnostic);
		// Do not propagate platform messages containing argv, cwd or secrets.
		// biome-ignore lint/style/useErrorCause: Raw platform causes may contain credentials or terminal arguments.
		throw new Error("Approved terminal could not be started");
	}
}
