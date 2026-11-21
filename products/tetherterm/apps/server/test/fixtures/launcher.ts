import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launcherFixture() {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-103-launcher-"));
	const token = randomBytes(32).toString("hex");
	const executable = Bun.which("bash", { PATH: "/usr/bin:/bin" });
	if (!executable) {
		await rm(root, { force: true, recursive: true });
		throw new Error("launcher proof requires bash");
	}
	const env = {
		CUSTOM_BEARER: token,
		PATH: `${new URL(".", `file://${process.execPath}`).pathname}:/usr/bin:/bin`,
		TETHERTERM_APPROVED_EXECUTABLES: JSON.stringify([executable]),
		TETHERTERM_APPROVED_ROOT: root,
		TETHERTERM_PORT: "0",
		TETHERTERM_TOKEN_ENV_VAR: "CUSTOM_BEARER",
		TETHERTERM_TUNNEL_HOSTNAME: "launcher.example.com",
	};
	return {
		cleanup: () => rm(root, { force: true, recursive: true }),
		env,
		root,
		token,
	};
}
