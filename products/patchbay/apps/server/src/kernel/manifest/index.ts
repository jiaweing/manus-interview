import { readFile } from "node:fs/promises";
import { ManifestValidationError } from "./errors";
import { MANIFEST_FILENAME, parseManifest } from "./parse";
import {
	resolvePackageFile,
	resolveRuntimeArgv,
	validatePackageRoot,
	validatePackageTree,
} from "./paths";
import type { ManifestValidationOptions, ValidatedLocalPackage } from "./types";

/** Read-only review, not installation or sandboxing. Never imports/spawns package code. */
export async function validateLocalPackage(
	path: string,
	options: ManifestValidationOptions = {}
): Promise<ValidatedLocalPackage> {
	const root = await validatePackageRoot(path);
	await validatePackageTree(root);
	const manifestPath = await resolvePackageFile(root, MANIFEST_FILENAME);
	let source: string;
	try {
		source = await readFile(manifestPath, "utf8");
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem causes contain unreviewed paths; public errors must be redacted.
		throw new ManifestValidationError("INVALID_PACKAGE_PATH");
	}
	const manifest = parseManifest(source, options);
	const argv = await resolveRuntimeArgv(root, manifest.runtime.argv);
	return { argv, manifest, manifestPath, root };
}
