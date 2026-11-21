export type JsonSchema = Record<string, unknown>;

export interface CapabilityDeclaration {
	description: string;
	input_schema: JsonSchema;
	name: string;
	required_permissions: string[];
	rpc_method: string;
}

export interface PluginManifest {
	config: { schema: JsonSchema; defaults: Record<string, unknown> };
	id: string;
	manifest_version: 1;
	min_host_version: string;
	name: string;
	permissions: string[];
	platforms: string[];
	providers: CapabilityDeclaration[];
	runtime: { argv: string[] };
	tools: CapabilityDeclaration[];
	version: string;
}

export interface ManifestValidationOptions {
	hostVersion?: string;
	/** Read-only installed IDs; validation never writes a registry. */
	installedIds?: Iterable<string>;
	platform?: string;
}

export interface ValidatedLocalPackage {
	/** Shell-free argv, with package executable/entry paths resolved. */
	argv: string[];
	manifest: PluginManifest;
	manifestPath: string;
	/** Canonical directory; all reviewed paths remain beneath it. */
	root: string;
}
