export interface SpawnPtyOptions {
	args?: string[];
	cols: number;
	cwd: string;
	env: Record<string, string>;
	executable: string;
	onData: (bytes: Uint8Array) => void;
	rows: number;
}

/** Linux's util-linux setsid supplies the session and controlling terminal. */
export function requireSetsid(path = Bun.env.PATH ?? "", cwd = process.cwd()) {
	if (process.platform !== "linux") {
		throw new Error(
			"TetherTerm native PTYs require Linux and util-linux setsid"
		);
	}
	const setsid = Bun.which("setsid", { cwd, PATH: path });
	if (!setsid) {
		throw new Error(
			"TetherTerm native PTYs require util-linux setsid on PATH; install util-linux before starting the server"
		);
	}
	return setsid;
}

export function spawnPty(options: SpawnPtyOptions) {
	const setsid = requireSetsid(options.env.PATH, options.cwd);
	const terminal = new Bun.Terminal({
		cols: options.cols,
		data(_terminal, bytes) {
			options.onData(bytes);
		},
		rows: options.rows,
	});
	try {
		// Do NOT use detached or setsid -f: the inherited parent pgid differs from
		// this fresh child pid, so setsid execs in place. child.pid is the sid/pgid.
		const child = Bun.spawn(
			[setsid, "-c", options.executable, ...(options.args ?? [])],
			{
				cwd: options.cwd,
				env: options.env,
				terminal,
			}
		);
		return { child, terminal };
	} catch (error) {
		terminal.close();
		throw error;
	}
}
