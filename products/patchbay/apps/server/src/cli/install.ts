import type { InstallPreview } from "../kernel/install";
import { StateError } from "../kernel/state/errors";

/** JSON escaping keeps all package-supplied declarations terminal-safe. */
export function formatInstallPreview(preview: InstallPreview): string {
	try {
		return [
			`Source: ${JSON.stringify(preview.sourceLocation)}`,
			`Plugin: ${JSON.stringify(preview.manifest.id)}`,
			`Package version: ${JSON.stringify(preview.version)}`,
			`Package hash: ${preview.packageHash}`,
			`Runtime argv: ${JSON.stringify(preview.runtimeArgv)}`,
			`Config schema: ${JSON.stringify(preview.manifest.config.schema)}`,
			`Tools (including input schemas): ${JSON.stringify(preview.manifest.tools)}`,
			`Providers (including input schemas): ${JSON.stringify(preview.manifest.providers)}`,
			`Permissions: ${JSON.stringify(preview.manifest.permissions)}`,
			preview.warning,
			"Installation executes no package code and installs disabled with no capabilities registered.",
			'Install this reviewed snapshot? Type "yes" to confirm [default: no]: ',
		].join("\n");
	} catch {
		// biome-ignore lint/style/useErrorCause: Never echo package serialization failures.
		throw new StateError("INSTALL_SNAPSHOT_FAILED");
	}
}
