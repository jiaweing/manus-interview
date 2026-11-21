import { constants } from "node:fs";
import { access, lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ManifestValidationError } from "./errors";

const shells = new Set([
	"sh",
	"bash",
	"dash",
	"zsh",
	"fish",
	"ksh",
	"csh",
	"tcsh",
	"env",
	"cmd",
	"cmd.exe",
	"powershell",
	"pwsh",
]);
const hostCommand = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function invalidPath(path: string): boolean {
	return (
		path.trim().length === 0 ||
		Array.from(path).some(
			(character) =>
				character.charCodeAt(0) < 32 ||
				character.charCodeAt(0) === 127 ||
				character === "\\"
		) ||
		path.split("/").includes("..")
	);
}

function within(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return (
		suffix === "" ||
		(!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../"))
	);
}

function pathOperand(value: string): boolean {
	return (
		value.includes("/") ||
		value.includes("\\") ||
		value === "." ||
		value === ".."
	);
}

/** V1: local executable, or bare host interpreter followed immediately by a local entry. */
export function validateRuntimeArgv(argv: unknown): asserts argv is string[] {
	if (
		!(
			Array.isArray(argv) &&
			argv.length > 0 &&
			argv.every((arg) => typeof arg === "string" && !invalidPath(arg))
		)
	) {
		throw new ManifestValidationError("INVALID_ARGV");
	}
	const executable = argv[0] as string;
	const bareExecutable = !pathOperand(executable);
	if (
		isAbsolute(executable) ||
		shells.has(executable.split("/").at(-1) ?? "") ||
		(bareExecutable && !hostCommand.test(executable))
	) {
		throw new ManifestValidationError("INVALID_ARGV");
	}
	if (
		bareExecutable &&
		(!(argv.length > 1 && pathOperand(argv[1])) ||
			argv[1].startsWith("-") ||
			isAbsolute(argv[1]))
	) {
		throw new ManifestValidationError("INVALID_ARGV");
	}
	if (argv.slice(1).some((arg) => isAbsolute(arg))) {
		throw new ManifestValidationError("INVALID_ARGV");
	}
}

export async function validatePackageRoot(path: string): Promise<string> {
	if (typeof path !== "string" || invalidPath(path) || path.includes("://")) {
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
	try {
		const absolute = resolve(path);
		const canonical = await realpath(absolute);
		if (canonical !== absolute || !(await lstat(absolute)).isDirectory()) {
			throw new ManifestValidationError("INVALID_PACKAGE_PATH");
		}
		return canonical;
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes include unreviewed paths; public errors must be redacted.
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
}

/** File must be package-relative and its resolved target must stay in the root. */
export async function resolvePackageFile(
	root: string,
	path: string
): Promise<string> {
	if (invalidPath(path) || isAbsolute(path)) {
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
	try {
		const resolved = resolve(root, path);
		const canonical = await realpath(resolved);
		if (
			!(
				within(root, resolved) &&
				within(root, canonical) &&
				(await stat(canonical)).isFile()
			)
		) {
			throw new ManifestValidationError("INVALID_PACKAGE_PATH");
		}
		return canonical;
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes include unreviewed paths; public errors must be redacted.
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
}

/** Inspect even unreferenced files: a later snapshot must not copy an escaping link. */
export async function validatePackageTree(root: string): Promise<void> {
	const visited = new Set<string>();
	async function walk(directory: string): Promise<void> {
		const canonical = await realpath(directory);
		if (!within(root, canonical)) {
			throw new ManifestValidationError("INVALID_PACKAGE_PATH");
		}
		if (visited.has(canonical)) {
			return;
		}
		visited.add(canonical);
		for (const entry of await readdir(canonical, { withFileTypes: true })) {
			const path = join(canonical, entry.name);
			// biome-ignore lint/performance/noAwaitInLoops: Walk sequentially to avoid exhausting descriptors on untrusted packages.
			const target = await realpath(path);
			if (!within(root, target)) {
				throw new ManifestValidationError("INVALID_PACKAGE_PATH");
			}
			const info = await stat(target);
			if (info.isDirectory()) {
				await walk(target);
			} else if (!info.isFile()) {
				throw new ManifestValidationError("INVALID_PACKAGE_PATH");
			}
		}
	}
	try {
		await walk(root);
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes include unreviewed paths; public errors must be redacted.
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
}

export async function resolveRuntimeArgv(
	root: string,
	argv: string[]
): Promise<string[]> {
	validateRuntimeArgv(argv);
	const resolved = [...argv];
	const executable = argv[0] as string;
	if (pathOperand(executable)) {
		resolved[0] = await resolvePackageFile(root, executable);
	} else {
		const hostExecutable = Bun.which(executable);
		if (!hostExecutable) {
			throw new ManifestValidationError("INVALID_ARGV");
		}
		resolved[0] = hostExecutable;
	}
	try {
		await access(resolved[0], constants.X_OK);
		if (!(await stat(resolved[0])).isFile()) {
			throw new ManifestValidationError("INVALID_ARGV");
		}
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes include unreviewed paths; public errors must be redacted.
		throw new ManifestValidationError("INVALID_ARGV");
	}
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index] as string;
		if (pathOperand(arg)) {
			// biome-ignore lint/performance/noAwaitInLoops: Resolve in argv order with bounded descriptor use and deterministic failures.
			resolved[index] = await resolvePackageFile(root, arg);
		}
	}
	return resolved;
}
