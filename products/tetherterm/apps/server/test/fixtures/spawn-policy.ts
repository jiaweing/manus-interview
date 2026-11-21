import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Environment } from "../../src/config";

export async function policyFixture() {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), "tetherterm-103-policy-"))
	);
	const root = join(base, "root");
	const nested = join(root, "nested");
	const outside = join(base, "root-other");
	await Promise.all([mkdir(nested, { recursive: true }), mkdir(outside)]);
	await symlink(outside, join(root, "escape"));
	await symlink(nested, join(root, "inside-link"));
	await writeFile(join(root, "not-directory"), "fixture\n");
	const token = randomBytes(32).toString("hex");
	const credential = randomBytes(32).toString("hex");
	const env: Environment = {
		CUSTOM_BEARER: token,
		HOME: root,
		LANG: "C.UTF-8",
		LC_CTYPE: "C.UTF-8",
		OPENAI_API_KEY: credential,
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: JSON.stringify(["bash"]),
		TETHERTERM_APPROVED_ROOT: root,
		TETHERTERM_PORT: "0",
		TETHERTERM_TOKEN_ENV_VAR: "CUSTOM_BEARER",
		TETHERTERM_TUNNEL_HOSTNAME: "approved.example.com",
	};
	return { base, credential, env, nested, outside, root, token };
}
