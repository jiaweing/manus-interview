import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ManifestValidationError } from "../manifest/errors";
import { StateError } from "./errors";

export interface StatePaths {
	plugins: string;
	registry: string;
	root: string;
}

export interface InstalledPlugin {
	enabled: boolean;
	grants: string[];
	id: string;
	installedPath: string;
	packageHash: string;
	userOverrides: Record<string, unknown>;
	version: string;
}

export interface Registry {
	formatVersion: 1;
	plugins: InstalledPlugin[];
}

/** Narrow filesystem seam for deterministic failure tests; no package hooks. */
export type StateFileSystem = Pick<typeof fs, "open" | "rename" | "rm">;
const queues = new Map<string, Promise<unknown>>();
const safeId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;

export async function statePaths(home: string): Promise<StatePaths> {
	try {
		if (typeof home !== "string" || !isAbsolute(home) || home.includes("\0")) {
			throw new StateError("INVALID_STATE_PATH");
		}
		const canonical = await fs.realpath(home);
		if (!(await fs.stat(canonical)).isDirectory()) {
			throw new StateError("INVALID_STATE_PATH");
		}
		const root = join(canonical, ".patchbay");
		return {
			plugins: join(root, "plugins"),
			registry: join(root, "registry.json"),
			root,
		};
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes may contain private paths.
		throw new StateError("INVALID_STATE_PATH");
	}
}

/** Shared across store instances in this foreground process, keyed by canonical state root. */
export async function serializeMutation<T>(
	key: string,
	operation: () => Promise<T>
): Promise<T> {
	const previous = queues.get(key) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(operation);
	queues.set(key, next);
	try {
		return await next;
	} catch (error) {
		if (
			error instanceof StateError ||
			error instanceof ManifestValidationError
		) {
			throw error;
		}
		// biome-ignore lint/style/useErrorCause: Mutation causes may contain user configuration.
		throw new StateError("STATE_WRITE_FAILED");
	} finally {
		if (queues.get(key) === next) {
			queues.delete(key);
		}
	}
}

/** Same-directory exclusive temp + fsync + rename; no fallible work after the commit point. */
export async function atomicWrite(
	path: string,
	bytes: string,
	io: StateFileSystem = fs
): Promise<void> {
	let temporary: string | undefined;
	let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		if (typeof path !== "string" || !isAbsolute(path)) {
			throw new StateError("STATE_WRITE_FAILED");
		}
		temporary = `${path}.${randomUUID()}.tmp`;
		handle = await io.open(temporary, "wx", 0o600);
		await handle.writeFile(bytes, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await io.rename(temporary, path);
		temporary = undefined;
	} catch {
		// biome-ignore lint/style/useErrorCause: Discard native IO/serialization details.
		throw new StateError("STATE_WRITE_FAILED");
	} finally {
		await handle?.close().catch(() => undefined);
		if (temporary) {
			await io.rm(temporary, { force: true }).catch(() => undefined);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function acquireLock(root: string): Promise<string> {
	const lock = join(root, ".mutation-lock");
	for (let attempt = 0; attempt < 300; attempt += 1) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: Exclusive mkdir must precede each bounded lock retry.
			await fs.mkdir(lock, { mode: 0o700 });
			return lock;
		} catch (error) {
			if (!(isRecord(error) && error.code === "EEXIST")) {
				throw error;
			}
		}
		await setTimeout(10);
	}
	throw new StateError("STATE_WRITE_FAILED");
}

function validateRegistry(
	value: unknown,
	paths: StatePaths
): asserts value is Registry {
	if (
		!isRecord(value) ||
		value.formatVersion !== 1 ||
		!Array.isArray(value.plugins)
	) {
		throw new StateError("STATE_READ_FAILED");
	}
	const ids = new Set<string>();
	for (const plugin of value.plugins) {
		if (
			!(
				isRecord(plugin) &&
				typeof plugin.id === "string" &&
				plugin.id.length <= 255 &&
				safeId.exec(plugin.id)?.[0] === plugin.id &&
				!ids.has(plugin.id) &&
				plugin.installedPath === join(paths.plugins, plugin.id) &&
				typeof plugin.version === "string" &&
				typeof plugin.packageHash === "string" &&
				hashPattern.exec(plugin.packageHash)?.[0] === plugin.packageHash &&
				typeof plugin.enabled === "boolean" &&
				isRecord(plugin.userOverrides) &&
				Array.isArray(plugin.grants) &&
				plugin.grants.every((grant) => typeof grant === "string")
			)
		) {
			throw new StateError("STATE_READ_FAILED");
		}
		ids.add(plugin.id);
	}
}

export class RegistryStore {
	readonly paths: StatePaths;
	readonly io: StateFileSystem;
	constructor(paths: StatePaths, io: StateFileSystem = fs) {
		this.paths = paths;
		this.io = io;
	}
	/** Creates state directories only for confirmed mutations, rejecting symlink aliases. */
	async prepare(): Promise<void> {
		try {
			await fs.mkdir(this.paths.root, { mode: 0o700, recursive: true });
			if ((await fs.realpath(this.paths.root)) !== resolve(this.paths.root)) {
				throw new StateError("INVALID_STATE_PATH");
			}
			await fs.mkdir(this.paths.plugins, { mode: 0o700, recursive: true });
			if (
				(await fs.realpath(this.paths.plugins)) !== resolve(this.paths.plugins)
			) {
				throw new StateError("INVALID_STATE_PATH");
			}
		} catch {
			// biome-ignore lint/style/useErrorCause: State IO causes include private paths.
			throw new StateError("STATE_WRITE_FAILED");
		}
	}
	async read(): Promise<Registry> {
		try {
			const info = await fs
				.lstat(this.paths.registry)
				.catch((error: unknown) => {
					if (isRecord(error) && error.code === "ENOENT") {
						return;
					}
					throw error;
				});
			if (!info) {
				return { formatVersion: 1, plugins: [] };
			}
			if (
				!info.isFile() ||
				(await fs.realpath(this.paths.root)) !== resolve(this.paths.root)
			) {
				throw new StateError("STATE_READ_FAILED");
			}
			const value: unknown = JSON.parse(
				await fs.readFile(this.paths.registry, "utf8")
			);
			validateRegistry(value, this.paths);
			return value;
		} catch {
			// biome-ignore lint/style/useErrorCause: JSON and IO causes can contain secrets.
			throw new StateError("STATE_READ_FAILED");
		}
	}
	async write(registry: Registry): Promise<void> {
		try {
			validateRegistry(registry, this.paths);
			await atomicWrite(
				this.paths.registry,
				`${JSON.stringify(registry, null, 2)}\n`,
				this.io
			);
		} catch {
			// biome-ignore lint/style/useErrorCause: Configuration values must never enter diagnostics.
			throw new StateError("STATE_WRITE_FAILED");
		}
	}
	/** All install/config/grant/lifecycle writers must use this lock and latest registry. */
	async mutate<T>(operation: (registry: Registry) => Promise<T>): Promise<T> {
		return await serializeMutation(this.paths.root, async () => {
			await this.prepare();
			const lock = await acquireLock(this.paths.root);
			try {
				return await operation(await this.read());
			} finally {
				// Never turn a committed update into a reported failure during lock cleanup.
				await fs.rmdir(lock).catch(() => undefined);
			}
		});
	}
}

export async function createRegistryStore(
	home: string,
	io?: StateFileSystem
): Promise<RegistryStore> {
	return new RegistryStore(await statePaths(home), io);
}
