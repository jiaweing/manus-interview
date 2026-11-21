import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { ConfigurationError } from "./errors";

export type Environment = Readonly<Record<string, string | undefined>>;
export type TransportMode = "stdio" | "http";

export interface ServerConfig {
	readonly approvedExecutables: Readonly<Record<string, string>>;
	readonly approvedRoot: string;
	readonly hostname: "127.0.0.1";
	readonly mode: TransportMode;
	readonly port: number;
	readonly tokenEnvVar?: string;
	readonly tunnelHostname?: string;
}

const nameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const hostnameSchema = z
	.string()
	.max(253)
	.regex(
		/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
	);
const INVALID_EXECUTABLE_NAME = /[\\/\s]/;
const executableSchema = z
	.string()
	.min(1)
	.refine((value) => !value.includes("\0"))
	.refine((value) => isAbsolute(value) || !INVALID_EXECUTABLE_NAME.test(value));
const commonSchema = z.object({
	approvedExecutables: z.array(executableSchema).min(1),
	approvedRoot: z.string().min(1).refine(isAbsolute),
	port: z.coerce.number().int().min(0).max(65_535),
});
const httpSchema = z.object({
	tokenEnvVar: nameSchema,
	tunnelHostname: hostnameSchema,
});
const tokenSchema = z
	.string()
	.regex(/^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/);

function parseExecutables(value: string | undefined): unknown {
	try {
		return JSON.parse(value ?? "null");
	} catch {
		// biome-ignore lint/style/useErrorCause: JSON errors may echo credentials, so no raw cause may cross this boundary.
		throw new ConfigurationError(
			"TETHERTERM_APPROVED_EXECUTABLES must be a nonempty JSON array of executable names or absolute paths"
		);
	}
}

/** Validate before listening; HTTP secrets are not needed for owner-trusted stdio. */
export async function loadConfig(
	mode: TransportMode,
	env: Environment = process.env
): Promise<ServerConfig> {
	const parsed = commonSchema.safeParse({
		approvedExecutables: parseExecutables(env.TETHERTERM_APPROVED_EXECUTABLES),
		approvedRoot: env.TETHERTERM_APPROVED_ROOT,
		port: env.TETHERTERM_PORT ?? "3000",
	});
	if (!parsed.success) {
		// Never format Zod's input/error object: it can contain credential values.
		throw new ConfigurationError(
			"require an absolute TETHERTERM_APPROVED_ROOT, a nonempty JSON TETHERTERM_APPROVED_EXECUTABLES array, and TETHERTERM_PORT between 0 and 65535"
		);
	}

	let http: z.infer<typeof httpSchema> | undefined;
	if (mode === "http") {
		const security = httpSchema.safeParse({
			tokenEnvVar: env.TETHERTERM_TOKEN_ENV_VAR,
			tunnelHostname: env.TETHERTERM_TUNNEL_HOSTNAME,
		});
		if (!security.success) {
			throw new ConfigurationError(
				"HTTP requires TETHERTERM_TUNNEL_HOSTNAME as an exact hostname (no URL, wildcard, or port) and TETHERTERM_TOKEN_ENV_VAR as an environment variable name"
			);
		}
		http = security.data;
		// Never retain the token in config or report it in a validation error.
		if (!tokenSchema.safeParse(env[http.tokenEnvVar]).success) {
			throw new ConfigurationError(
				"HTTP requires a 32-byte bearer token encoded as hex, base64, or base64url in the configured environment variable"
			);
		}
	}

	let approvedRoot: string;
	const approvedExecutables: Record<string, string> = Object.create(null);
	try {
		approvedRoot = await realpath(parsed.data.approvedRoot);
		if (!(await stat(approvedRoot)).isDirectory()) {
			throw new Error("not a directory");
		}
		await Promise.all(
			parsed.data.approvedExecutables.map(async (executable) => {
				const resolved = isAbsolute(executable)
					? executable
					: Bun.which(executable, {
							cwd: approvedRoot,
							PATH: env.PATH ?? "",
						});
				if (!resolved) {
					throw new Error("not an executable");
				}
				const canonical = await realpath(resolved);
				if (!(await stat(canonical)).isFile()) {
					throw new Error("not a file");
				}
				await access(canonical, constants.X_OK);
				approvedExecutables[executable] = canonical;
			})
		);
	} catch {
		// biome-ignore lint/style/useErrorCause: Filesystem errors include untrusted paths; deliberately discard the original cause.
		throw new ConfigurationError(
			"approved root must exist as a directory and all approved executables must resolve to executable files"
		);
	}

	return Object.freeze({
		approvedExecutables: Object.freeze(approvedExecutables),
		approvedRoot,
		hostname: "127.0.0.1",
		mode,
		port: parsed.data.port,
		// Keep the token variable name even in stdio so it cannot reach children.
		tokenEnvVar: http?.tokenEnvVar ?? env.TETHERTERM_TOKEN_ENV_VAR,
		tunnelHostname: http?.tunnelHostname,
	});
}

/** Entrypoints must use this boundary (or await loadConfig) before listening. */
export async function startWithConfig<T>(
	mode: TransportMode,
	start: (config: ServerConfig) => T | Promise<T>,
	env: Environment = process.env
): Promise<T> {
	const config = await loadConfig(mode, env);
	return start(config);
}
