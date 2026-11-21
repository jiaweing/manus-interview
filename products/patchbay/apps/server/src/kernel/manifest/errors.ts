export const MANIFEST_ERROR_CODES = {
	DUPLICATE_PLUGIN_ID: "DUPLICATE_PLUGIN_ID",
	INCOMPATIBLE_HOST_VERSION: "INCOMPATIBLE_HOST_VERSION",
	INCOMPATIBLE_PLATFORM: "INCOMPATIBLE_PLATFORM",
	INVALID_ARGV: "INVALID_ARGV",
	INVALID_DECLARATION: "INVALID_DECLARATION",
	INVALID_DEFAULTS: "INVALID_DEFAULTS",
	INVALID_MANIFEST: "INVALID_MANIFEST",
	INVALID_PACKAGE_PATH: "INVALID_PACKAGE_PATH",
	INVALID_SCHEMA: "INVALID_SCHEMA",
	UNSUPPORTED_MANIFEST_VERSION: "UNSUPPORTED_MANIFEST_VERSION",
} as const;

export type ManifestErrorCode =
	(typeof MANIFEST_ERROR_CODES)[keyof typeof MANIFEST_ERROR_CODES];

const messages: Record<ManifestErrorCode, string> = {
	DUPLICATE_PLUGIN_ID: "The plugin ID is already installed.",
	INCOMPATIBLE_HOST_VERSION: "The package requires a newer compatible host.",
	INCOMPATIBLE_PLATFORM: "The package must support the Linux host.",
	INVALID_ARGV:
		"Runtime argv must use a shell-free executable and local entry.",
	INVALID_DECLARATION:
		"Capability declarations must be unambiguous and use declared permissions.",
	INVALID_DEFAULTS:
		"Configuration or schema defaults do not satisfy their schemas.",
	INVALID_MANIFEST: "The plugin manifest is malformed or has unknown fields.",
	INVALID_PACKAGE_PATH:
		"The package and its file paths must remain inside an existing local directory.",
	INVALID_SCHEMA:
		"Schemas must be valid synchronous JSON Schema draft-07 objects with local references.",
	UNSUPPORTED_MANIFEST_VERSION: "The manifest version is not supported.",
};

/** Never incorporates parser errors, source text, paths, or configuration values. */
export class ManifestValidationError extends Error {
	readonly code: ManifestErrorCode;

	constructor(code: ManifestErrorCode) {
		super(messages[code]);
		this.name = "ManifestValidationError";
		this.code = code;
	}
}
