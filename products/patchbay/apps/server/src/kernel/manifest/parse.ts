import Ajv from "ajv";
import addFormats from "ajv-formats";
import { gte, valid } from "semver";
import { parse } from "smol-toml";
import { ManifestValidationError } from "./errors";
import { validateRuntimeArgv } from "./paths";
import { manifestSchema } from "./schema";
import type {
	JsonSchema,
	ManifestValidationOptions,
	PluginManifest,
} from "./types";

export const HOST_VERSION = "0.1.0";
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = "patchbay-plugin.toml";

const validateShape = new Ajv({ strict: true }).compile<PluginManifest>(
	manifestSchema
);

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childNodes(
	value: Record<string, unknown> | unknown[],
	pointer: string
): [JsonSchema, string][] {
	return Object.entries(value).flatMap(([name, child]) =>
		isObject(child)
			? schemaNodes(
					child,
					`${pointer}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`
				)
			: []
	);
}

function schemaNodes(
	schema: JsonSchema,
	pointer = "#"
): [JsonSchema, string][] {
	const nodes: [JsonSchema, string][] = [[schema, pointer]];
	for (const [key, value] of Object.entries(schema)) {
		const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
		if (
			[
				"properties",
				"patternProperties",
				"definitions",
				"$defs",
				"dependencies",
			].includes(key) &&
			isObject(value)
		) {
			nodes.push(...childNodes(value, childPointer));
		} else if (
			["allOf", "anyOf", "oneOf", "items"].includes(key) &&
			Array.isArray(value)
		) {
			nodes.push(...childNodes(value, childPointer));
		} else if (
			[
				"items",
				"additionalItems",
				"additionalProperties",
				"contains",
				"not",
				"if",
				"then",
				"else",
				"propertyNames",
			].includes(key) &&
			isObject(value)
		) {
			nodes.push(...schemaNodes(value, childPointer));
		}
	}
	return nodes;
}

/** Compile without loading remote references, coercing data, or applying defaults. */
export function compilePluginSchema(
	schema: JsonSchema
): (value: unknown) => boolean {
	try {
		if (schema.type !== "object") {
			throw new ManifestValidationError("INVALID_SCHEMA");
		}
		const nodes = schemaNodes(schema);
		for (const [node] of nodes) {
			if (
				"$async" in node ||
				(typeof node.$ref === "string" && !node.$ref.startsWith("#"))
			) {
				throw new ManifestValidationError("INVALID_SCHEMA");
			}
		}
		const ajv = new Ajv({
			allErrors: true,
			logger: false,
			strict: true,
			validateFormats: true,
		});
		addFormats(ajv);
		ajv.addSchema(schema, "patchbay-schema");
		const validator = ajv.getSchema("patchbay-schema");
		if (!validator) {
			throw new ManifestValidationError("INVALID_SCHEMA");
		}
		for (const [node, pointer] of nodes) {
			if ("default" in node) {
				const checkDefault = ajv.getSchema(`patchbay-schema${pointer}`);
				if (!checkDefault?.(node.default)) {
					throw new ManifestValidationError("INVALID_DEFAULTS");
				}
			}
		}
		return (value: unknown) => {
			try {
				return validator(value) === true;
			} catch {
				// Non-productive references can compile but overflow when invoked; productive recursion remains supported.
				// biome-ignore lint/style/useErrorCause: Validator causes can expose schema/config values; discard them deliberately.
				throw new ManifestValidationError("INVALID_SCHEMA");
			}
		};
	} catch (error) {
		if (error instanceof ManifestValidationError) {
			throw error;
		}
		// biome-ignore lint/style/useErrorCause: Ajv causes can expose schema/config values; discard them deliberately.
		throw new ManifestValidationError("INVALID_SCHEMA");
	}
}

function isCanonicalVersion(version: string): boolean {
	// valid checks the entire SemVer string but omits build metadata from its result.
	const normalized = valid(version);
	return normalized !== null && normalized === version.split("+", 1)[0];
}

function validateCompatibility(
	manifest: PluginManifest,
	options: ManifestValidationOptions
) {
	if (manifest.manifest_version !== MANIFEST_VERSION) {
		throw new ManifestValidationError("UNSUPPORTED_MANIFEST_VERSION");
	}
	if (
		!(
			isCanonicalVersion(manifest.version) &&
			isCanonicalVersion(manifest.min_host_version)
		)
	) {
		throw new ManifestValidationError("INVALID_MANIFEST");
	}
	const hostVersion = options.hostVersion ?? HOST_VERSION;
	if (!(valid(hostVersion) && gte(hostVersion, manifest.min_host_version))) {
		throw new ManifestValidationError("INCOMPATIBLE_HOST_VERSION");
	}
	if (
		(options.platform ?? process.platform) !== "linux" ||
		!manifest.platforms.includes("linux")
	) {
		throw new ManifestValidationError("INCOMPATIBLE_PLATFORM");
	}
	if (new Set(options.installedIds).has(manifest.id)) {
		throw new ManifestValidationError("DUPLICATE_PLUGIN_ID");
	}
}

/** Parse and validate static declarations only; performs no package IO or execution. */
export function validateManifest(
	value: unknown,
	options: ManifestValidationOptions = {}
): PluginManifest {
	if (!validateShape(value)) {
		throw new ManifestValidationError("INVALID_MANIFEST");
	}
	let manifest: PluginManifest;
	try {
		manifest = structuredClone(value);
	} catch {
		// biome-ignore lint/style/useErrorCause: Clone causes can include untrusted values; reject without retaining them.
		throw new ManifestValidationError("INVALID_MANIFEST");
	}
	manifest.tools ??= [];
	manifest.providers ??= [];
	validateCompatibility(manifest, options);
	validateRuntimeArgv(manifest.runtime.argv);
	const capabilities = [...manifest.tools, ...manifest.providers];
	const names = new Set<string>();
	const permissions = new Set(manifest.permissions);
	if (capabilities.length === 0) {
		throw new ManifestValidationError("INVALID_DECLARATION");
	}
	for (const capability of capabilities) {
		if (
			names.has(capability.name) ||
			capability.required_permissions.some(
				(permission) => !permissions.has(permission)
			)
		) {
			throw new ManifestValidationError("INVALID_DECLARATION");
		}
		names.add(capability.name);
		compilePluginSchema(capability.input_schema);
	}
	const validateConfig = compilePluginSchema(manifest.config.schema);
	if (!validateConfig(manifest.config.defaults)) {
		throw new ManifestValidationError("INVALID_DEFAULTS");
	}
	return manifest;
}

export function parseManifest(
	source: string,
	options: ManifestValidationOptions = {}
): PluginManifest {
	let value: unknown;
	try {
		value = parse(source);
	} catch {
		// biome-ignore lint/style/useErrorCause: Parser causes include source text and may reveal secrets.
		throw new ManifestValidationError("INVALID_MANIFEST");
	}
	return validateManifest(value, options);
}
