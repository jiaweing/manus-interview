import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "smol-toml";
import { validateLocalPackage } from "../src/kernel/manifest";
import type { ManifestErrorCode } from "../src/kernel/manifest/errors";
import { ManifestValidationError } from "../src/kernel/manifest/errors";
import {
	compilePluginSchema,
	parseManifest,
	validateManifest,
} from "../src/kernel/manifest/parse";
import type {
	CapabilityDeclaration,
	PluginManifest,
} from "../src/kernel/manifest/types";

let temporary: string;
let root: string;
let registry: string;
let marker: string;
const registryBytes = '{"installed":[{"id":"existing","enabled":false}]}\n';

function toolManifest(): PluginManifest {
	return {
		config: {
			defaults: { limit: 5 },
			schema: {
				additionalProperties: false,
				properties: { limit: { default: 5, minimum: 1, type: "integer" } },
				type: "object",
			},
		},
		id: "test-tool",
		manifest_version: 1,
		min_host_version: "0.1.0",
		name: "Test Tool",
		permissions: ["workspace:read"],
		platforms: ["linux"],
		providers: [],
		runtime: { argv: ["bun", "./worker.ts"] },
		tools: [
			{
				description: "Search workspace text",
				input_schema: {
					additionalProperties: false,
					properties: { query: { type: "string" } },
					required: ["query"],
					type: "object",
				},
				name: "search",
				required_permissions: ["workspace:read"],
				rpc_method: "tools/call",
			},
		],
		version: "1.2.3",
	};
}

function firstTool(manifest: PluginManifest): CapabilityDeclaration {
	const [tool] = manifest.tools;
	if (!tool) {
		throw new Error("The test fixture must have a tool.");
	}
	return tool;
}

async function writeManifest(value: unknown = toolManifest()) {
	await writeFile(
		join(root, "patchbay-plugin.toml"),
		stringify(value as Record<string, unknown>)
	);
}

async function unchanged() {
	expect(await readFile(registry, "utf8")).toBe(registryBytes);
	expect(await Bun.file(marker).exists()).toBe(false);
}

async function rejects(
	operation: () => unknown | Promise<unknown>,
	code: ManifestErrorCode
) {
	let caught: unknown;
	try {
		await operation();
	} catch (failure) {
		caught = failure;
	}
	expect(caught).toBeInstanceOf(ManifestValidationError);
	const error = caught as ManifestValidationError;
	expect(error.code).toBe(code);
	expect(error.message).toBe(new ManifestValidationError(code).message);
	expect(error.message).not.toContain(temporary);
	expect(error.message).not.toContain("DO_NOT_ECHO_CONFIG");
	await unchanged();
}

beforeEach(async () => {
	temporary = await mkdtemp(join(tmpdir(), "patchbay-manifest-"));
	root = join(temporary, "package");
	registry = join(temporary, "home/.patchbay/registry.json");
	marker = join(temporary, "execution-marker");
	await mkdir(root);
	await mkdir(join(temporary, "home/.patchbay"), { recursive: true });
	await writeFile(registry, registryBytes);
	await writeFile(
		join(root, "worker.ts"),
		`await Bun.write(${JSON.stringify(marker)}, "executed");\nthrow new Error("package code must not load");\n`
	);
	await writeManifest();
});

afterEach(async () => {
	await rm(temporary, { force: true, recursive: true });
});

describe("declarative manifest acceptance", () => {
	test("minimal Linux tool parses and resolves argv without executing its marker fixture or changing registry bytes", async () => {
		const source = await readFile(join(root, "patchbay-plugin.toml"), "utf8");
		const declarations = parseManifest(source);
		expect(declarations.tools[0]?.name).toBe("search");
		const result = await validateLocalPackage(root, {
			installedIds: ["existing"],
		});
		expect(result.root).toBe(root);
		expect(result.argv).toEqual([
			Bun.which("bun") ?? "missing-bun",
			join(root, "worker.ts"),
		]);
		expect(result.manifest).toEqual(toolManifest());
		await unchanged();
	});

	test("minimal llm@1 provider is declarative and does not need a hard-coded plugin ID", async () => {
		const manifest = toolManifest();
		manifest.id = "independent-provider";
		manifest.permissions = ["network:local"];
		manifest.providers = [
			{
				description: "Local inference",
				input_schema: { type: "object" },
				name: "llm@1",
				required_permissions: ["network:local"],
				rpc_method: "services/call",
			},
		];
		manifest.tools = [];
		await writeManifest(manifest);
		const result = await validateLocalPackage(root);
		expect(result.manifest.providers[0]?.name).toBe("llm@1");
		expect(result.manifest.tools).toEqual([]);
		await unchanged();
	});

	test("omitted unused declaration list normalizes to empty without mutating input", () => {
		const { providers: _providers, ...value } = toolManifest();
		expect(validateManifest(value).providers).toEqual([]);
		expect("providers" in value).toBe(false);
	});

	test("accepts a local executable, internal symlinks, and directory-link cycles without loading code", async () => {
		const executable = join(root, "worker");
		await writeFile(
			executable,
			"#!/usr/bin/env bun\nthrow new Error('must not execute');\n"
		);
		await chmod(executable, 0o755);
		await symlink("worker", join(root, "worker-link"));
		await symlink(".", join(root, "cycle"));
		const manifest = toolManifest();
		manifest.runtime.argv = [
			"./worker-link",
			"literal argument with spaces",
			"$(not-shell-code)",
			";",
		];
		await writeManifest(manifest);
		expect((await validateLocalPackage(root)).argv).toEqual([
			executable,
			"literal argument with spaces",
			"$(not-shell-code)",
			";",
		]);
		await unchanged();
	});

	test("local references and valid embedded defaults compile without applying or coercing defaults", () => {
		const schema = {
			additionalProperties: false,
			definitions: { positive: { default: 2, minimum: 1, type: "integer" } },
			properties: { count: { $ref: "#/definitions/positive" } },
			type: "object",
		};
		const validator = compilePluginSchema(schema);
		const config = {};
		expect(validator(config)).toBe(true);
		expect(config).toEqual({});
		expect(validator({ count: "2" })).toBe(false);
	});

	test("version comparison is numeric and supports exact release/prerelease versions", () => {
		const manifest = toolManifest();
		manifest.min_host_version = "0.2.0";
		expect(validateManifest(manifest, { hostVersion: "0.10.0" }).id).toBe(
			manifest.id
		);
		manifest.min_host_version = "0.2.0-beta.1";
		expect(validateManifest(manifest, { hostVersion: "0.2.0" }).id).toBe(
			manifest.id
		);
	});
});

const rejectedDeclarations: [
	string,
	ManifestErrorCode,
	(manifest: PluginManifest) => void,
][] = [
	[
		"unsupported manifest version",
		"UNSUPPORTED_MANIFEST_VERSION",
		(m) => {
			Object.assign(m, { manifest_version: 2 });
		},
	],
	[
		"incompatible host version",
		"INCOMPATIBLE_HOST_VERSION",
		(m) => {
			m.min_host_version = "99.0.0";
		},
	],
	[
		"non-Linux platform",
		"INCOMPATIBLE_PLATFORM",
		(m) => {
			m.platforms = ["darwin"];
		},
	],
	[
		"invalid package semver",
		"INVALID_MANIFEST",
		(m) => {
			m.version = "latest";
		},
	],
	[
		"noncanonical package semver",
		"INVALID_MANIFEST",
		(m) => {
			m.version = "v1.2.3";
		},
	],
	[
		"invalid minimum host version",
		"INVALID_MANIFEST",
		(m) => {
			m.min_host_version = ">=0.1.0";
		},
	],
	[
		"invalid ID",
		"INVALID_MANIFEST",
		(m) => {
			m.id = "../escape";
		},
	],
	[
		"blank name",
		"INVALID_MANIFEST",
		(m) => {
			m.name = "   ";
		},
	],
	[
		"unknown manifest field/hooks",
		"INVALID_MANIFEST",
		(m) => {
			Object.assign(m, { startup: ["bun", "./worker.ts"] });
		},
	],
	[
		"duplicate permission",
		"INVALID_MANIFEST",
		(m) => {
			m.permissions.push("workspace:read");
		},
	],
	[
		"undeclared required permission",
		"INVALID_DECLARATION",
		(m) => {
			firstTool(m).required_permissions = ["network:remote"];
		},
	],
	[
		"duplicate exact tool declaration",
		"INVALID_DECLARATION",
		(m) => {
			m.tools.push(structuredClone(firstTool(m)));
		},
	],
	[
		"ambiguous tool/provider name",
		"INVALID_DECLARATION",
		(m) => {
			m.providers.push(structuredClone(firstTool(m)));
		},
	],
	[
		"no capabilities",
		"INVALID_DECLARATION",
		(m) => {
			m.tools = [];
		},
	],
	[
		"missing capability description",
		"INVALID_MANIFEST",
		(m) => {
			Object.assign(firstTool(m), { description: undefined });
		},
	],
	[
		"invalid RPC method",
		"INVALID_MANIFEST",
		(m) => {
			firstTool(m).rpc_method = "run shell command";
		},
	],
	[
		"invalid capability name",
		"INVALID_MANIFEST",
		(m) => {
			firstTool(m).name = "ambiguous name";
		},
	],
	[
		"unknown capability field",
		"INVALID_MANIFEST",
		(m) => {
			Object.assign(firstTool(m), { hook: "startup" });
		},
	],
	[
		"invalid config schema type",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = { type: "unknown" };
		},
	],
	[
		"unknown schema keyword",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = { type: "object", unknownKeyword: true };
		},
	],
	[
		"non-object input schema",
		"INVALID_SCHEMA",
		(m) => {
			firstTool(m).input_schema = { type: "string" };
		},
	],
	[
		"bad input schema",
		"INVALID_SCHEMA",
		(m) => {
			firstTool(m).input_schema = {
				properties: { value: { type: "invalid" } },
				type: "object",
			};
		},
	],
	[
		"remote schema reference",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = {
				$ref: "https://example.invalid/schema",
				type: "object",
			};
		},
	],
	[
		"missing local schema reference",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = { $ref: "#/definitions/missing", type: "object" };
		},
	],
	[
		"async schema",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = { $async: true, type: "object" };
		},
	],
	[
		"schema from unsupported draft",
		"INVALID_SCHEMA",
		(m) => {
			m.config.schema = {
				$schema: "https://json-schema.org/draft/2020-12/schema",
				type: "object",
			};
		},
	],
	[
		"config defaults violate schema",
		"INVALID_DEFAULTS",
		(m) => {
			m.config.defaults.limit = "DO_NOT_ECHO_CONFIG";
		},
	],
	[
		"unknown config default",
		"INVALID_DEFAULTS",
		(m) => {
			m.config.defaults.extra = true;
		},
	],
	[
		"invalid embedded schema default",
		"INVALID_DEFAULTS",
		(m) => {
			m.config.schema = {
				properties: { count: { default: "bad", type: "integer" } },
				type: "object",
			};
			m.config.defaults = {};
		},
	],
	[
		"invalid embedded input default",
		"INVALID_DEFAULTS",
		(m) => {
			firstTool(m).input_schema = {
				properties: { count: { default: "bad", type: "integer" } },
				type: "object",
			};
		},
	],
	[
		"argv shell string",
		"INVALID_MANIFEST",
		(m) => {
			Object.assign(m.runtime, { argv: "bun ./worker.ts" });
		},
	],
	[
		"empty argv",
		"INVALID_MANIFEST",
		(m) => {
			m.runtime.argv = [];
		},
	],
	[
		"non-string argv element",
		"INVALID_MANIFEST",
		(m) => {
			Object.assign(m.runtime, { argv: ["bun", 1] });
		},
	],
	[
		"empty argv element",
		"INVALID_MANIFEST",
		(m) => {
			m.runtime.argv = ["bun", ""];
		},
	],
	[
		"shell execution",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["sh", "-c", "bun ./worker.ts"];
		},
	],
	[
		"shell via package path",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["./bash", "-c", "code"];
		},
	],
	[
		"env wrapper",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["env", "bun", "./worker.ts"];
		},
	],
	[
		"interpreter eval",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "--eval", "code"];
		},
	],
	[
		"interpreter without entry",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun"];
		},
	],
	[
		"nonlocal entry",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "worker.ts"];
		},
	],
	[
		"entry traversal",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "./../worker.ts"];
		},
	],
	[
		"traversal even if normalized inside root",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "./dir/../worker.ts"];
		},
	],
	[
		"absolute executable",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["/usr/bin/bun", "./worker.ts"];
		},
	],
	[
		"absolute entry",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "/tmp/worker.ts"];
		},
	],
	[
		"absolute path operand",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv.push("/tmp/input");
		},
	],
	[
		"NUL argv",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", "./worker\u0000.ts"];
		},
	],
	[
		"Windows path argv",
		"INVALID_ARGV",
		(m) => {
			m.runtime.argv = ["bun", ".\\worker.ts"];
		},
	],
];

describe("stable rejection of malformed declarations", () => {
	for (const [name, code, change] of rejectedDeclarations) {
		test(`${name}: ${code}; marker absent and registry unchanged`, async () => {
			const manifest = toolManifest();
			change(manifest);
			// Validate unknown raw input too; missing fields cannot be TOML-stringified.
			await rejects(() => validateManifest(manifest), code);
			if (name !== "missing capability description") {
				await writeManifest(manifest);
				await rejects(() => validateLocalPackage(root), code);
			}
		});
	}

	test("malformed TOML yields a redacted stable parser error", async () => {
		await writeFile(
			join(root, "patchbay-plugin.toml"),
			'id = "DO_NOT_ECHO_CONFIG\n'
		);
		await rejects(() => validateLocalPackage(root), "INVALID_MANIFEST");
	});

	test("duplicate ID checks read-only installed IDs", async () => {
		const installedIds = new Set(["test-tool"]);
		await rejects(
			() => validateLocalPackage(root, { installedIds }),
			"DUPLICATE_PLUGIN_ID"
		);
		expect([...installedIds]).toEqual(["test-tool"]);
	});

	test("a Linux declaration cannot activate on another platform", async () => {
		await rejects(
			() => validateLocalPackage(root, { platform: "win32" }),
			"INCOMPATIBLE_PLATFORM"
		);
	});
});

describe("local package boundaries", () => {
	for (const kind of [
		"file",
		"directory",
		"manifest",
		"entry",
		"dangling",
		"prefix-sibling",
	] as const) {
		test(`rejects ${kind} escaping/broken symlink: INVALID_PACKAGE_PATH`, async () => {
			const outside = join(temporary, "outside");
			await writeFile(outside, "untrusted");
			if (kind === "directory") {
				await symlink(temporary, join(root, "escape"));
			} else if (kind === "manifest" || kind === "entry") {
				const filename =
					kind === "manifest" ? "patchbay-plugin.toml" : "worker.ts";
				await rm(join(root, filename));
				await symlink(outside, join(root, filename));
			} else if (kind === "prefix-sibling") {
				await mkdir(`${root}-sibling`);
				await writeFile(join(`${root}-sibling`, "file"), "untrusted");
				await symlink(join(`${root}-sibling`, "file"), join(root, "escape"));
			} else {
				await symlink(
					kind === "dangling" ? join(temporary, "missing") : outside,
					join(root, "escape")
				);
			}
			await rejects(() => validateLocalPackage(root), "INVALID_PACKAGE_PATH");
		});
	}

	test("rejects nonexistent, file, traversal, empty, remote, and symlink package roots", async () => {
		const alias = join(temporary, "alias");
		await symlink(root, alias);
		for (const path of [
			join(temporary, "missing"),
			join(root, "worker.ts"),
			`${root}/../package`,
			"",
			"https://example.invalid/package",
			alias,
		]) {
			// biome-ignore lint/performance/noAwaitInLoops: Assert registry bytes and absent marker independently after each rejected path.
			await rejects(() => validateLocalPackage(path), "INVALID_PACKAGE_PATH");
		}
	});

	test("rejects missing manifest and missing entry", async () => {
		await rm(join(root, "patchbay-plugin.toml"));
		await rejects(() => validateLocalPackage(root), "INVALID_PACKAGE_PATH");
		await writeManifest();
		await rm(join(root, "worker.ts"));
		await rejects(() => validateLocalPackage(root), "INVALID_PACKAGE_PATH");
	});

	test("rejects directory entry and nonexecutable local executable", async () => {
		await rm(join(root, "worker.ts"));
		await mkdir(join(root, "worker.ts"));
		await rejects(() => validateLocalPackage(root), "INVALID_PACKAGE_PATH");
		await rm(join(root, "worker.ts"), { recursive: true });
		await writeFile(join(root, "worker.ts"), "not executable");
		const manifest = toolManifest();
		manifest.runtime.argv = ["./worker.ts"];
		await writeManifest(manifest);
		await rejects(() => validateLocalPackage(root), "INVALID_ARGV");
	});
});

describe("schema and declaration edge cases", () => {
	test("standard URI formats validate config defaults", async () => {
		const manifest = toolManifest();
		manifest.config.schema = {
			additionalProperties: false,
			properties: { endpoint: { format: "uri", type: "string" } },
			type: "object",
		};
		manifest.config.defaults = { endpoint: "http://127.0.0.1:8080/v1" };
		await writeManifest(manifest);
		expect((await validateLocalPackage(root)).manifest.config.defaults).toEqual(
			manifest.config.defaults
		);
		manifest.config.defaults.endpoint = "not a URI";
		await writeManifest(manifest);
		await rejects(() => validateLocalPackage(root), "INVALID_DEFAULTS");
	});

	test("missing capability field is also rejected through the TOML package path", async () => {
		const manifest = toolManifest();
		const { description: _description, ...declaration } = firstTool(manifest);
		await writeManifest({ ...manifest, tools: [declaration] });
		await rejects(() => validateLocalPackage(root), "INVALID_MANIFEST");
	});

	test("duplicate provider names are rejected even with different RPC methods", async () => {
		const manifest = toolManifest();
		manifest.tools = [];
		const provider = {
			description: "Inference",
			input_schema: { type: "object" },
			name: "llm@1",
			required_permissions: [],
			rpc_method: "services/call",
		};
		manifest.providers = [
			provider,
			{ ...provider, rpc_method: "other/method" },
		];
		await writeManifest(manifest);
		await rejects(() => validateLocalPackage(root), "INVALID_DECLARATION");
	});

	test("referenced and nested array defaults are validated", async () => {
		const manifest = toolManifest();
		manifest.config.schema = {
			definitions: { positive: { minimum: 1, type: "integer" } },
			properties: { count: { $ref: "#/definitions/positive", default: -1 } },
			type: "object",
		};
		manifest.config.defaults = {};
		await writeManifest(manifest);
		await rejects(() => validateLocalPackage(root), "INVALID_DEFAULTS");
		manifest.config.schema = {
			properties: {
				counts: { items: { default: "bad", type: "integer" }, type: "array" },
			},
			type: "object",
		};
		await writeManifest(manifest);
		await rejects(() => validateLocalPackage(root), "INVALID_DEFAULTS");
	});

	test("non-cloneable raw values do not escape as native errors", async () => {
		const manifest = toolManifest();
		manifest.config.defaults.value = () => "untrusted";
		await rejects(() => validateManifest(manifest), "INVALID_MANIFEST");
	});
});

test("unavailable host executable fails without running package code or modifying registry", async () => {
	const manifest = toolManifest();
	manifest.runtime.argv = [
		"patchbay-test-nonexistent-runtime-53",
		"./worker.ts",
	];
	await writeManifest(manifest);
	await rejects(() => validateLocalPackage(root), "INVALID_ARGV");
});
