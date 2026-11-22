import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLocalPackage } from "../manifest";
import { ManifestValidationError } from "../manifest/errors";
import type {
	ManifestValidationOptions,
	PluginManifest,
} from "../manifest/types";
import type { InstalledPlugin, RegistryStore } from "../state";
import { StateError } from "../state/errors";
import {
	captureSnapshot,
	materializeSnapshot,
	type PackageSnapshot,
	type SnapshotFileSystem,
} from "./snapshot";

export const UNSANDBOXED_WARNING =
	"WARNING: Plugins run as the current user and are NOT SANDBOXED. Host grants constrain host-mediated dispatch only, not arbitrary filesystem or network access. Review source before enabling.";

export interface InstallPreview {
	manifest: PluginManifest;
	packageHash: string;
	runtimeArgv: string[];
	sourceLocation: string;
	version: string;
	warning: string;
}
interface PrivateReview {
	manifest: PluginManifest;
	snapshot: PackageSnapshot;
}
export interface InstallerOptions {
	/** Deterministic write-failure seam, used only when staging a confirmed install. */
	stagingIO?: SnapshotFileSystem;
	validation?: ManifestValidationOptions;
}

function stable(
	error: unknown,
	fallback: "INSTALL_SNAPSHOT_FAILED" | "INSTALL_STAGING_FAILED"
): never {
	if (error instanceof ManifestValidationError || error instanceof StateError) {
		throw error;
	}
	throw new StateError(fallback);
}

export class PluginInstaller {
	readonly #reviews = new WeakMap<InstallPreview, PrivateReview>();
	readonly #store: RegistryStore;
	readonly #options: InstallerOptions;
	constructor(store: RegistryStore, options: InstallerOptions = {}) {
		this.#store = store;
		this.#options = options;
	}
	/** No state writes, package imports, subprocesses, downloads, or hooks. */
	async preview(path: string): Promise<InstallPreview> {
		let temporary: string | undefined;
		try {
			const registry = await this.#store.read();
			const validation = {
				...this.#options.validation,
				installedIds: registry.plugins.map((plugin) => plugin.id),
			};
			const source = await validateLocalPackage(path, validation);
			const snapshot = await captureSnapshot(source.root);
			temporary = await fs.mkdtemp(join(tmpdir(), "patchbay-review-"));
			await materializeSnapshot(snapshot, temporary);
			// Authoritative review is of captured bytes, not the earlier mutable manifest.
			const reviewed = await validateLocalPackage(temporary, validation);
			const manifest = structuredClone(reviewed.manifest);
			const preview: InstallPreview = {
				manifest: structuredClone(manifest),
				packageHash: snapshot.hash,
				runtimeArgv: [...manifest.runtime.argv],
				sourceLocation: source.root,
				version: manifest.version,
				warning: UNSANDBOXED_WARNING,
			};
			this.#reviews.set(preview, { manifest, snapshot });
			return preview;
		} catch (error) {
			return stable(error, "INSTALL_SNAPSHOT_FAILED");
		} finally {
			if (temporary) {
				await fs
					.rm(temporary, { force: true, recursive: true })
					.catch(() => undefined);
			}
		}
	}
	/** Only literal true confirms. Review data is private and cannot be edited by the caller. */
	async confirm(
		preview: InstallPreview,
		confirmed: boolean
	): Promise<InstalledPlugin | null> {
		try {
			const review = this.#reviews.get(preview);
			if (!review) {
				throw new StateError("INVALID_INSTALL_REVIEW");
			}
			this.#reviews.delete(preview);
			if (confirmed !== true) {
				return null;
			}
			return await this.#store.mutate(async (registry) => {
				if (
					registry.plugins.some((plugin) => plugin.id === review.manifest.id)
				) {
					throw new ManifestValidationError("DUPLICATE_PLUGIN_ID");
				}
				let staged: string | undefined;
				let installed: string | undefined;
				try {
					const destination = join(
						this.#store.paths.plugins,
						review.manifest.id
					);
					if (
						await fs.lstat(destination).then(
							() => true,
							(error: unknown) => {
								if (
									typeof error === "object" &&
									error !== null &&
									"code" in error &&
									error.code === "ENOENT"
								) {
									return false;
								}
								throw error;
							}
						)
					) {
						throw new ManifestValidationError("DUPLICATE_PLUGIN_ID");
					}
					staged = await fs.mkdtemp(
						join(this.#store.paths.plugins, ".install-")
					);
					await materializeSnapshot(
						review.snapshot,
						staged,
						this.#options.stagingIO
					);
					await validateLocalPackage(staged, this.#options.validation);
					if ((await captureSnapshot(staged)).hash !== review.snapshot.hash) {
						throw new StateError("INSTALL_STAGING_FAILED");
					}
					await this.#store.io.rename(staged, destination);
					installed = destination;
					staged = undefined;
					const record: InstalledPlugin = {
						enabled: false,
						grants: [],
						id: review.manifest.id,
						installedPath: destination,
						packageHash: review.snapshot.hash,
						userOverrides: {},
						version: review.manifest.version,
					};
					await this.#store.write({
						...registry,
						plugins: [...registry.plugins, record],
					});
					// Registry rename is the commit point: do not perform fallible work after it.
					installed = undefined;
					return record;
				} catch (error) {
					return stable(error, "INSTALL_STAGING_FAILED");
				} finally {
					for (const path of [staged, installed]) {
						if (path) {
							// biome-ignore lint/performance/noAwaitInLoops: Roll back owned artifacts before releasing the registry mutation lock.
							await fs
								.rm(path, { force: true, recursive: true })
								.catch(() => undefined);
						}
					}
				}
			});
		} catch (error) {
			return stable(error, "INSTALL_STAGING_FAILED");
		}
	}
}

/** CLI/library convenience wrapper; a review callback must explicitly return true. */
export async function installPackage(
	path: string,
	installer: PluginInstaller,
	confirm: (preview: InstallPreview) => Promise<boolean>
): Promise<InstalledPlugin | null> {
	try {
		const preview = await installer.preview(path);
		return await installer.confirm(preview, await confirm(preview));
	} catch (error) {
		return stable(error, "INSTALL_STAGING_FAILED");
	}
}
