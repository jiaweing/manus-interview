import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { validatePackageRoot } from "../manifest/paths";
import { StateError } from "../state/errors";

export type SnapshotEntry =
	| { kind: "directory"; path: string }
	| { kind: "file"; path: string; mode: number; bytes: Buffer }
	| { kind: "symlink"; path: string; target: string };
export interface PackageSnapshot {
	entries: SnapshotEntry[];
	hash: string;
}
export type SnapshotFileSystem = Pick<
	typeof fs,
	"writeFile" | "mkdir" | "symlink" | "chmod"
>;
// These flags have disjoint bits. Summation avoids disguising boolean operations.
const directoryFlags =
	constants.O_RDONLY + constants.O_DIRECTORY + constants.O_NOFOLLOW;
const fileFlags =
	constants.O_RDONLY + constants.O_NOFOLLOW + constants.O_NONBLOCK;

function inside(root: string, target: string): boolean {
	const suffix = relative(root, target);
	return (
		suffix === "" ||
		(!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../"))
	);
}
function entryMetadata(entry: SnapshotEntry): unknown[] {
	if (entry.kind === "file") {
		return [entry.kind, entry.path, entry.mode, entry.bytes.length];
	}
	if (entry.kind === "symlink") {
		return [entry.kind, entry.path, entry.target];
	}
	return [entry.kind, entry.path];
}

/** SHA-256 over sorted, length-framed entry metadata and file bytes; excludes times/root paths. */
export function hashSnapshot(entries: SnapshotEntry[]): string {
	try {
		const hash = createHash("sha256");
		hash.update("patchbay-snapshot/1\n");
		for (const entry of [...entries].sort((a, b) =>
			a.path < b.path ? -1 : Number(a.path > b.path)
		)) {
			const metadata = JSON.stringify(entryMetadata(entry));
			hash.update(`${Buffer.byteLength(metadata)}:`);
			hash.update(metadata);
			if (entry.kind === "file") {
				hash.update(entry.bytes);
			}
		}
		return `sha256:${hash.digest("hex")}`;
	} catch {
		// biome-ignore lint/style/useErrorCause: Native hashing errors must not escape review APIs.
		throw new StateError("INSTALL_SNAPSHOT_FAILED");
	}
}

/** Opens every root ancestor without following symlinks, including paths replaced during review. */
async function openRoot(root: string): Promise<FileHandle> {
	let handle = await fs.open("/", directoryFlags);
	try {
		for (const component of root.split("/").filter(Boolean)) {
			// biome-ignore lint/performance/noAwaitInLoops: Anchor each ancestor to the previous descriptor before closing it.
			const child = await fs.open(
				`/proc/self/fd/${handle.fd}/${component}`,
				directoryFlags
			);
			await handle.close();
			handle = child;
		}
		return handle;
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}
async function readEntry(
	root: string,
	operand: string,
	local: string
): Promise<SnapshotEntry> {
	const info = await fs.lstat(operand);
	if (info.isSymbolicLink()) {
		const target = await fs.realpath(operand);
		if (!inside(root, target)) {
			throw new StateError("INSTALL_SNAPSHOT_FAILED");
		}
		// Normalize even absolute internal links to snapshot-relative targets.
		return {
			kind: "symlink",
			path: local,
			target: relative(dirname(join(root, local)), target) || ".",
		};
	}
	if (info.isDirectory()) {
		return { kind: "directory", path: local };
	}
	if (!info.isFile()) {
		throw new StateError("INSTALL_SNAPSHOT_FAILED");
	}
	const file = await fs.open(operand, fileFlags);
	try {
		const actual = await file.stat();
		if (!actual.isFile()) {
			throw new StateError("INSTALL_SNAPSHOT_FAILED");
		}
		return {
			bytes: await file.readFile(),
			kind: "file",
			mode: actual.mode % 0o1000,
			path: local,
		};
	} finally {
		await file.close();
	}
}

/** Linux descriptor-anchored walk: never reads through a source symlink or replaced ancestor. */
export async function captureSnapshot(path: string): Promise<PackageSnapshot> {
	try {
		const root = await validatePackageRoot(path);
		const entries: SnapshotEntry[] = [];
		async function walk(handle: FileHandle, prefix: string): Promise<void> {
			try {
				const anchored = `/proc/self/fd/${handle.fd}`;
				const names = (await fs.readdir(anchored)).sort();
				for (const name of names) {
					const local = join(prefix, name);
					const operand = join(anchored, name);
					// biome-ignore lint/performance/noAwaitInLoops: Bound descriptors and keep directory-before-child order.
					const entry = await readEntry(root, operand, local);
					entries.push(entry);
					if (entry.kind === "directory") {
						await walk(await fs.open(operand, directoryFlags), local);
					}
				}
			} finally {
				await handle.close();
			}
		}
		await walk(await openRoot(root), "");
		return { entries, hash: hashSnapshot(entries) };
	} catch {
		// biome-ignore lint/style/useErrorCause: Source paths and filesystem causes are untrusted.
		throw new StateError("INSTALL_SNAPSHOT_FAILED");
	}
}

/** Writes only captured bytes into a fresh private directory, never re-reads mutable source. */
export async function materializeSnapshot(
	snapshot: PackageSnapshot,
	destination: string,
	io: SnapshotFileSystem = fs
): Promise<void> {
	try {
		for (const entry of snapshot.entries) {
			const target = resolve(destination, entry.path);
			if (!inside(destination, target) || target === destination) {
				throw new StateError("INSTALL_STAGING_FAILED");
			}
			if (entry.kind === "directory") {
				// biome-ignore lint/performance/noAwaitInLoops: Parents must exist before their children, with bounded IO.
				await io.mkdir(target, { mode: 0o700 });
			} else if (entry.kind === "file") {
				await io.writeFile(target, entry.bytes, { flag: "wx", mode: 0o600 });
				await io.chmod(target, entry.mode);
			}
		}
		// Links are created last, so copying cannot write through them.
		for (const entry of snapshot.entries) {
			if (entry.kind === "symlink") {
				const target = resolve(destination, entry.path);
				if (
					!(
						inside(destination, target) &&
						inside(destination, resolve(dirname(target), entry.target))
					)
				) {
					throw new StateError("INSTALL_STAGING_FAILED");
				}
				// biome-ignore lint/performance/noAwaitInLoops: Complete each owned link before returning the snapshot.
				await io.symlink(entry.target, target);
			}
		}
	} catch {
		// biome-ignore lint/style/useErrorCause: Native writes may include source/package data.
		throw new StateError("INSTALL_STAGING_FAILED");
	}
}
