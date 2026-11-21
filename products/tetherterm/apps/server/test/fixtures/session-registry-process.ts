import { loadConfig } from "../../src/config";
import { TerminalError } from "../../src/errors";
import { SessionManager } from "../../src/sessions/manager";

const [mode, cwd, sessionId] = process.argv.slice(2);
if (!cwd) {
	throw new Error("Session registry fixture requires a working directory");
}
const env = {
	PATH: "/usr/bin:/bin",
	TETHERTERM_APPROVED_EXECUTABLES: '["bash"]',
	TETHERTERM_APPROVED_ROOT: cwd,
};
const config = await loadConfig("stdio", env);
const manager = new SessionManager(config, { env });
if (mode === "create") {
	const created = await manager.create({
		args: ["--noprofile", "--norc", "-c", "exit 0"],
		cwd,
		executable: "bash",
	});
	const session = manager.get(created.sessionId);
	try {
		await session.pty.child.exited;
		console.log(
			JSON.stringify({
				pid: session.pty.child.pid,
				sessionId: created.sessionId,
			})
		);
	} finally {
		if (session.pty.child.exitCode === null) {
			session.pty.child.kill("SIGKILL");
		}
		await session.pty.child.exited;
		session.pty.terminal.close();
	}
} else {
	try {
		manager.status(sessionId ?? "");
		throw new Error("A previous process's ID must not be found");
	} catch (error) {
		if (!(error instanceof TerminalError)) {
			throw error;
		}
		console.log(JSON.stringify({ code: error.code }));
	}
}
