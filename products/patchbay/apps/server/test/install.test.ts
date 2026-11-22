import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { stringify } from "smol-toml";
import { main } from "../src/cli";
import { runSession } from "../src/cli/session";
import { createKernel } from "../src/kernel";
import {
	installPackage,
	PluginInstaller,
	UNSANDBOXED_WARNING,
} from "../src/kernel/install";
import { captureSnapshot, hashSnapshot } from "../src/kernel/install/snapshot";
import { ManifestValidationError } from "../src/kernel/manifest/errors";
import type { PluginManifest } from "../src/kernel/manifest/types";
import {
	atomicWrite,
	createRegistryStore,
	type Registry,
	type RegistryStore,
} from "../src/kernel/state";
import { StateError } from "../src/kernel/state/errors";

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const invocationPattern =
	/bun (install|run build)|npm (install|run build)|pnpm (install|build)/;
function firstPlugin(registry: Registry) {
	const [plugin] = registry.plugins;
	if (!plugin) {
		throw new Error("Expected installed fixture");
	}
	return plugin;
}
let temporary: string;
let home: string;
let root: string;
let marker: string;
let store: RegistryStore;
let installer: PluginInstaller;
function manifest(id = "reviewed-tool"): PluginManifest {
	return {
		config: {
			defaults: {},
			schema: { additionalProperties: false, type: "object" },
		},
		id,
		manifest_version: 1,
		min_host_version: "0.1.0",
		name: "Reviewed Tool",
		permissions: ["workspace:read"],
		platforms: ["linux"],
		providers: [],
		runtime: { argv: ["bun", "./worker.ts"] },
		tools: [
			{
				description: "Read text",
				input_schema: { additionalProperties: false, type: "object" },
				name: "search",
				required_permissions: ["workspace:read"],
				rpc_method: "tools/call",
			},
		],
		version: "1.2.3+review.54",
	};
}
async function packageAt(path: string, id = "reviewed-tool") {
	await fs.mkdir(path, { recursive: true });
	await fs.writeFile(
		join(path, "patchbay-plugin.toml"),
		stringify(manifest(id))
	);
	await fs.writeFile(
		join(path, "worker.ts"),
		`await Bun.write(${JSON.stringify(marker)}, "executed"); throw new Error("must not execute");\n`
	);
	await fs.writeFile(
		join(path, "package.json"),
		JSON.stringify({
			scripts: {
				build: `touch ${marker}`,
				install: `touch ${marker}`,
				postinstall: `touch ${marker}`,
			},
		})
	);
	await fs.writeFile(join(path, "payload.txt"), "reviewed bytes\n");
}
async function seed() {
	const old = join(temporary, "old-source");
	await packageAt(old, "previous-tool");
	await installer.confirm(await installer.preview(old), true);
	return await fs.readFile(store.paths.registry, "utf8");
}
async function assertUnchanged(bytes: string) {
	expect(await fs.readFile(store.paths.registry, "utf8")).toBe(bytes);
	expect((await fs.readdir(store.paths.plugins)).sort()).toEqual([
		"previous-tool",
	]);
	expect(
		await fs.readFile(
			join(store.paths.plugins, "previous-tool/payload.txt"),
			"utf8"
		)
	).toBe("reviewed bytes\n");
	expect(await Bun.file(marker).exists()).toBe(false);
}
async function rejected(
	operation: () => unknown | Promise<unknown>,
	code: string
) {
	let caught: unknown;
	try {
		await operation();
	} catch (failure) {
		caught = failure;
	}
	expect(
		caught instanceof StateError || caught instanceof ManifestValidationError
	).toBe(true);
	const error = caught as { code: string; cause?: unknown; message: string };
	expect(error.code).toBe(code);
	expect(error.cause).toBeUndefined();
	expect(error.message).not.toContain(temporary);
	expect(error.message).not.toContain("PRIVATE_TEST_VALUE");
}
function memoryOutput() {
	let stdout = "";
	let stderr = "";
	return {
		error: new Writable({
			write(chunk, _encoding, callback) {
				stderr += chunk.toString();
				callback();
			},
		}),
		output: new Writable({
			write(chunk, _encoding, callback) {
				stdout += chunk.toString();
				callback();
			},
		}),
		read: () => ({ stderr, stdout }),
	};
}
beforeEach(async () => {
	temporary = await fs.mkdtemp(join(tmpdir(), "patchbay-install-test-"));
	home = join(temporary, "home");
	root = join(temporary, "package");
	marker = join(temporary, "execution-marker");
	await fs.mkdir(home);
	await packageAt(root);
	store = await createRegistryStore(home);
	installer = new PluginInstaller(store);
});
afterEach(async () => {
	await fs.rm(temporary, { force: true, recursive: true });
});

describe("reviewed snapshot installation", () => {
	test("preview has all declarations and warning; confirmation installs matching snapshot disabled, no capabilities or execution markers", async () => {
		const preview = await installer.preview(root);
		expect(preview.sourceLocation).toBe(root);
		expect(preview.version).toBe(manifest().version);
		expect(preview.packageHash).toMatch(hashPattern);
		expect(preview.runtimeArgv).toEqual(["bun", "./worker.ts"]);
		expect(preview.manifest).toEqual(manifest());
		expect(preview.warning).toBe(UNSANDBOXED_WARNING);
		expect(await Bun.file(store.paths.registry).exists()).toBe(false);
		const record = await installer.confirm(preview, true);
		expect(record).toEqual({
			enabled: false,
			grants: [],
			id: manifest().id,
			installedPath: join(store.paths.plugins, manifest().id),
			packageHash: preview.packageHash,
			userOverrides: {},
			version: preview.version,
		});
		expect((await store.read()).plugins).toEqual([
			record as NonNullable<typeof record>,
		]);
		expect((await captureSnapshot(record?.installedPath ?? "")).hash).toBe(
			preview.packageHash
		);
		expect(await Bun.file(marker).exists()).toBe(false);
		expect(createKernel().tools.size).toBe(0);
		expect(createKernel().providers.size).toBe(0);
	});
	test("confirmation copies the private reviewed bytes/hash despite changed or deleted source and mutable public preview fields", async () => {
		const preview = await installer.preview(root);
		const hash = preview.packageHash;
		await fs.writeFile(join(root, "payload.txt"), "changed after review");
		await fs.writeFile(
			join(root, "patchbay-plugin.toml"),
			stringify(manifest("changed-id"))
		);
		await fs.rm(root, { recursive: true });
		preview.packageHash = "tampered";
		preview.version = "9.9.9";
		preview.manifest.id = "tampered";
		const record = await installer.confirm(preview, true);
		expect(record?.id).toBe("reviewed-tool");
		expect(record?.version).toBe(manifest().version);
		expect(record?.packageHash).toBe(hash);
		expect(
			await fs.readFile(
				join(record?.installedPath ?? "", "payload.txt"),
				"utf8"
			)
		).toBe("reviewed bytes\n");
		expect((await captureSnapshot(record?.installedPath ?? "")).hash).toBe(
			hash
		);
	});
	test("cancellation preserves prior registry bytes and packages and consumes the review", async () => {
		const bytes = await seed();
		const preview = await installer.preview(root);
		expect(await installer.confirm(preview, false)).toBeNull();
		await rejected(
			() => installer.confirm(preview, true),
			"INVALID_INSTALL_REVIEW"
		);
		await assertUnchanged(bytes);
	});
	test("cancelled fresh install creates no .patchbay state directory", async () => {
		expect(
			await installPackage(root, installer, () => Promise.resolve(false))
		).toBeNull();
		expect(await fs.readdir(home)).toEqual([]);
	});
	test("duplicate IDs are rejected before preview without replacing prior installation", async () => {
		const bytes = await seed();
		await fs.writeFile(
			join(root, "patchbay-plugin.toml"),
			stringify(manifest("previous-tool"))
		);
		await rejected(() => installer.preview(root), "DUPLICATE_PLUGIN_ID");
		await assertUnchanged(bytes);
	});
	test("concurrent stores serialize duplicate confirmation; losing review preserves winning bytes", async () => {
		const other = new PluginInstaller(await createRegistryStore(home));
		const [one, two] = await Promise.all([
			installer.preview(root),
			other.preview(root),
		]);
		const results = await Promise.allSettled([
			installer.confirm(one, true),
			other.confirm(two, true),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled")
		).toHaveLength(1);
		const failed = results.find((result) => result.status === "rejected");
		expect(failed?.status === "rejected" && failed.reason.code).toBe(
			"DUPLICATE_PLUGIN_ID"
		);
		expect((await store.read()).plugins).toHaveLength(1);
		expect(await fs.readdir(store.paths.plugins)).toEqual(["reviewed-tool"]);
	});
	test("independent foreground processes serialize different installs without losing registry entries", async () => {
		const second = join(temporary, "second-source");
		await packageAt(second, "second.tool");
		const results = await Promise.all(
			[root, second].map(async (source) => {
				const child = Bun.spawn(
					[
						process.execPath,
						"--no-install",
						"--no-env-file",
						"run",
						join(import.meta.dir, "../src/cli.ts"),
					],
					{
						env: { HOME: home, NO_COLOR: "1", PATH: process.env.PATH ?? "" },
						stderr: "pipe",
						stdin: "pipe",
						stdout: "pipe",
					}
				);
				child.stdin.write(`plugin install ${source}\nyes\nexit\n`);
				child.stdin.end();
				const [stdout, stderr, code] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				return { code, stderr, stdout };
			})
		);
		for (const result of results) {
			expect(result.code).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("disabled; 0 capabilities registered");
		}
		expect(
			(await store.read()).plugins.map((plugin) => plugin.id).sort()
		).toEqual(["reviewed-tool", "second.tool"]);
		expect((await fs.readdir(store.paths.root)).sort()).toEqual([
			"plugins",
			"registry.json",
		]);
	});
	test("Unicode payloads, spaces in source paths, literal trailing argv whitespace and large schema numbers retain matching bytes/hash", async () => {
		const source = join(temporary, "review package 雪");
		await packageAt(source, "odd.tool");
		const declaration = manifest("odd.tool");
		declaration.runtime.argv.push("literal argument ");
		if (declaration.tools[0]) {
			Object.assign(declaration.tools[0].input_schema, {
				properties: { amount: { maximum: 1e100, type: "number" } },
			});
		}
		await fs.writeFile(
			join(source, "patchbay-plugin.toml"),
			stringify(declaration)
		);
		await fs.writeFile(
			join(source, "payload 雪.txt"),
			"snow 雪; emoji-free text\u2028line\n"
		);
		const preview = await installer.preview(source);
		const record = await installer.confirm(preview, true);
		expect(record?.id).toBe("odd.tool");
		expect(preview.runtimeArgv.at(-1)).toBe("literal argument ");
		expect((await captureSnapshot(record?.installedPath ?? "")).hash).toBe(
			preview.packageHash
		);
	});
	test("hash is deterministic across order/root/mtime and changes for bytes or executable mode", async () => {
		const second = join(temporary, "second");
		await packageAt(second);
		const first = await captureSnapshot(root);
		expect((await captureSnapshot(second)).hash).toBe(first.hash);
		expect(hashSnapshot([...first.entries].reverse())).toBe(first.hash);
		await fs.utimes(join(second, "payload.txt"), new Date(0), new Date(0));
		expect((await captureSnapshot(second)).hash).toBe(first.hash);
		await fs.chmod(join(second, "worker.ts"), 0o755);
		expect((await captureSnapshot(second)).hash).not.toBe(first.hash);
		await fs.writeFile(join(root, "payload.txt"), "different bytes");
		expect((await captureSnapshot(root)).hash).not.toBe(first.hash);
	});
	test("internal absolute links, file links, directory links/cycles normalize inside installed snapshot and preserve executable modes", async () => {
		await fs.mkdir(join(root, "data"));
		await fs.writeFile(join(root, "data/text.txt"), "linked bytes");
		await fs.symlink(join(root, "data/text.txt"), join(root, "absolute-link"));
		await fs.symlink("data", join(root, "directory-link"));
		await fs.symlink(".", join(root, "cycle"));
		await fs.chmod(join(root, "worker.ts"), 0o755);
		const preview = await installer.preview(root);
		const record = await installer.confirm(preview, true);
		const installed = record?.installedPath ?? "";
		expect(await fs.readlink(join(installed, "absolute-link"))).toBe(
			"data/text.txt"
		);
		expect(
			await fs.readFile(join(installed, "directory-link/text.txt"), "utf8")
		).toBe("linked bytes");
		expect((await fs.stat(join(installed, "worker.ts"))).mode % 0o1000).toBe(
			0o755
		);
		expect((await captureSnapshot(installed)).hash).toBe(preview.packageHash);
	});
	test("escaping symlink anywhere rejects review and leaves prior state", async () => {
		const bytes = await seed();
		await fs.symlink(home, join(root, "escape"));
		await rejected(() => installer.preview(root), "INVALID_PACKAGE_PATH");
		await assertUnchanged(bytes);
	});
});

describe("failure atomicity and shared state helpers", () => {
	for (const phase of [
		"copy",
		"package-rename",
		"registry-open",
		"registry-write",
		"registry-sync",
		"registry-rename",
	] as const) {
		test(`${phase} failure preserves registry bytes/packages and removes staging/temp artifacts`, async () => {
			const bytes = await seed();
			const failingStore = await createRegistryStore(home, {
				...fs,
				async open(path, flags, mode) {
					if (phase === "registry-open") {
						throw new Error("PRIVATE_TEST_VALUE");
					}
					const handle = await fs.open(path, flags, mode);
					if (phase === "registry-write") {
						handle.writeFile = () =>
							Promise.reject(new Error("PRIVATE_TEST_VALUE"));
					}
					if (phase === "registry-sync") {
						handle.sync = () => Promise.reject(new Error("PRIVATE_TEST_VALUE"));
					}
					return handle;
				},
				async rename(from, to) {
					if (
						phase === "package-rename" ||
						(phase === "registry-rename" && to === store.paths.registry)
					) {
						throw new Error("PRIVATE_TEST_VALUE");
					}
					await fs.rename(from, to);
				},
			});
			const failing = new PluginInstaller(failingStore, {
				stagingIO: {
					...fs,
					async writeFile(path, data, options) {
						if (phase === "copy") {
							throw new Error("PRIVATE_TEST_VALUE");
						}
						await fs.writeFile(path, data, options);
					},
				},
			});
			const preview = await failing.preview(root);
			await rejected(
				() => failing.confirm(preview, true),
				phase.startsWith("registry")
					? "STATE_WRITE_FAILED"
					: "INSTALL_STAGING_FAILED"
			);
			await assertUnchanged(bytes);
			expect((await fs.readdir(store.paths.root)).sort()).toEqual([
				"plugins",
				"registry.json",
			]);
		});
	}
	test("a preexisting unregistered destination is never overwritten", async () => {
		const bytes = await seed();
		const destination = join(store.paths.plugins, "reviewed-tool");
		await fs.mkdir(destination);
		await fs.writeFile(join(destination, "keep"), "prior bytes");

		const preview = await installer.preview(root);
		await rejected(
			() => installer.confirm(preview, true),
			"DUPLICATE_PLUGIN_ID"
		);
		expect(await fs.readFile(store.paths.registry, "utf8")).toBe(bytes);
		expect(await fs.readFile(join(destination, "keep"), "utf8")).toBe(
			"prior bytes"
		);
	});
	test("shared mutation reads latest state and recovers its queue after failure", async () => {
		await seed();
		const other = await createRegistryStore(home);
		await Promise.all([
			store.mutate(async (registry) => {
				firstPlugin(registry).userOverrides = { limit: 2 };
				await store.write(registry);
			}),
			other.mutate(async (registry) => {
				firstPlugin(registry).grants = ["workspace:read"];
				await other.write(registry);
			}),
		]);
		expect((await store.read()).plugins[0]).toMatchObject({
			grants: ["workspace:read"],
			userOverrides: { limit: 2 },
		});
		await rejected(
			() =>
				store.mutate(() =>
					Promise.reject(new RangeError("PRIVATE_TEST_VALUE"))
				),
			"STATE_WRITE_FAILED"
		);
		expect(
			await other.mutate((registry) => Promise.resolve(registry.plugins.length))
		).toBe(1);
	});
	test("malformed registry and cyclic state values map to stable errors without leaking input", async () => {
		const bytes = await seed();
		await fs.writeFile(store.paths.registry, "PRIVATE_TEST_VALUE");
		await rejected(() => installer.preview(root), "STATE_READ_FAILED");
		await fs.writeFile(store.paths.registry, bytes);
		const value = await store.read();
		firstPlugin(value).userOverrides.loop = value;
		await rejected(() => store.write(value), "STATE_WRITE_FAILED");
		await assertUnchanged(bytes);
	});
	test("symlinked registry is rejected without touching its target", async () => {
		await seed();
		await fs.rm(store.paths.registry);
		const target = join(temporary, "other-registry");
		await fs.writeFile(target, "PRIVATE_TEST_VALUE");
		await fs.symlink(target, store.paths.registry);
		await rejected(() => installer.preview(root), "STATE_READ_FAILED");
		expect(await fs.readFile(target, "utf8")).toBe("PRIVATE_TEST_VALUE");
	});
	for (const path of [
		"",
		"relative",
		`/${"a".repeat(4096)}`,
		`/tmp/${"a".repeat(256)}`,
		"/tmp/odd\u0000name",
		"/tmp/missing\u2028name",
	]) {
		test(`invalid state/package path length ${path.length} is stable and redacted`, async () => {
			await rejected(() => createRegistryStore(path), "INVALID_STATE_PATH");
			await rejected(() => installer.preview(path), "INVALID_PACKAGE_PATH");
		});
	}
	test("huge ID is rejected stably during install rather than raising native filename errors", async () => {
		const bytes = await seed();
		await fs.writeFile(
			join(root, "patchbay-plugin.toml"),
			stringify(manifest("a".repeat(4096)))
		);
		const preview = await installer.preview(root);
		await rejected(
			() => installer.confirm(preview, true),
			"INSTALL_STAGING_FAILED"
		);
		await assertUnchanged(bytes);
	});
	test("invalid review/hash/atomic path never leaks a native exception", async () => {
		await rejected(
			() => installer.confirm(null as never, true),
			"INVALID_INSTALL_REVIEW"
		);
		await rejected(
			() =>
				hashSnapshot([
					{ bytes: null, kind: "file", mode: 1, path: "bad" } as never,
				]),
			"INSTALL_SNAPSHOT_FAILED"
		);
		await rejected(
			() => atomicWrite(`/tmp/${"a".repeat(4096)}`, "PRIVATE_TEST_VALUE"),
			"STATE_WRITE_FAILED"
		);
		await rejected(
			() => atomicWrite(null as never, "PRIVATE_TEST_VALUE"),
			"STATE_WRITE_FAILED"
		);
	});
});

describe("foreground CLI install", () => {
	test("all preview fields and warning precede confirmation; buffered yes installs without download/build invocation or execution", async () => {
		const io = memoryOutput();
		const kernel = createKernel();
		await runSession(kernel, {
			...io,
			home,
			input: Readable.from([`plugin install ${root}\nyes\nhelp\nexit\n`]),
			terminal: false,
		});
		const { stdout, stderr } = io.read();
		const prompt = stdout.indexOf('Install this reviewed snapshot? Type "yes"');
		for (const field of [
			"Source:",
			"Package version:",
			"Package hash:",
			"Runtime argv:",
			"Config schema:",
			"Tools (including input schemas):",
			"Providers (including input schemas):",
			"Permissions:",
			UNSANDBOXED_WARNING,
		]) {
			expect(stdout.indexOf(field)).toBeGreaterThanOrEqual(0);
			expect(stdout.indexOf(field)).toBeLessThan(prompt);
		}
		expect(stdout).toContain("Installed reviewed-tool disabled");
		expect(stdout).toContain("Commands: help, exit");
		expect(stdout).not.toMatch(invocationPattern);
		expect(stderr).toBe("");
		expect(await Bun.file(marker).exists()).toBe(false);
		expect(kernel.tools.size + kernel.providers.size).toBe(0);
	});
	for (const response of ["", "no", "y", "YES", "yes ", "exit"]) {
		test(`only exact yes confirms; response ${JSON.stringify(response)} cancels`, async () => {
			const io = memoryOutput();
			expect(
				await main({
					...io,
					home,
					input: Readable.from([`plugin install ${root}\n${response}\n`]),
					platform: "linux",
					terminal: false,
				})
			).toBe(0);
			expect(io.read().stdout).toContain("Installation cancelled");
			expect(await fs.readdir(home)).toEqual([]);
		});
	}
	test("EOF during confirmation cancels without creating state", async () => {
		const io = memoryOutput();
		expect(
			await main({
				...io,
				home,
				input: Readable.from([`plugin install ${root}\n`]),
				platform: "linux",
				terminal: false,
			})
		).toBe(0);
		expect(io.read().stdout).toContain("Installation cancelled");
		expect(await fs.readdir(home)).toEqual([]);
	});
	test("a real subprocess CLI install uses the requested HOME and emits no ANSI escapes", async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				"--no-env-file",
				"run",
				join(import.meta.dir, "../src/cli.ts"),
			],
			{
				env: { HOME: home, NO_COLOR: "1", PATH: process.env.PATH ?? "" },
				stderr: "pipe",
				stdin: "pipe",
				stdout: "pipe",
			}
		);
		child.stdin.write(`plugin install ${root}\nyes\nexit\n`);
		child.stdin.end();
		const stdout = await new Response(child.stdout).text();
		expect(await child.exited).toBe(0);
		expect(await new Response(child.stderr).text()).toBe("");
		expect(stdout).toContain("Installed reviewed-tool disabled");
		expect(stdout).not.toContain("\u001b");
		expect((await store.read()).plugins[0]?.enabled).toBe(false);
		expect(await Bun.file(marker).exists()).toBe(false);
	});
	test("source mutation after the visible prompt still installs reviewed bytes", async () => {
		const io = memoryOutput();
		const input = new PassThrough();
		const running = main({
			...io,
			home,
			input,
			platform: "linux",
			terminal: false,
		});
		input.write(`plugin install ${root}\n`);
		for (
			let attempt = 0;
			attempt < 100 && !io.read().stdout.includes('Type "yes"');
			attempt += 1
		) {
			// biome-ignore lint/performance/noAwaitInLoops: Wait for the actual CLI prompt before mutating source.
			await Bun.sleep(5);
		}
		expect(io.read().stdout).toContain('Type "yes"');
		await fs.writeFile(
			join(root, "payload.txt"),
			"modified after visible preview"
		);
		input.end("yes\nexit\n");
		expect(await running).toBe(0);
		const record = firstPlugin(await store.read());
		expect(
			await fs.readFile(join(record.installedPath, "payload.txt"), "utf8")
		).toBe("reviewed bytes\n");
		expect((await captureSnapshot(record.installedPath)).hash).toBe(
			record.packageHash
		);
	});
	test("install errors are stable, redacted, and recoverable by help/exit", async () => {
		const io = memoryOutput();
		expect(
			await main({
				...io,
				home,
				input: Readable.from([
					`plugin install /tmp/${"a".repeat(4096)}\nhelp\nexit\n`,
				]),
				platform: "linux",
				terminal: false,
			})
		).toBe(0);
		expect(io.read().stderr).toContain("ERROR [INVALID_PACKAGE_PATH]");
		expect(io.read().stderr).not.toContain("a".repeat(256));
		expect(io.read().stdout).toContain("Commands: help, exit");
	});
});
