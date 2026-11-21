// Standalone diagnostic: historical reusable attachment versus native inline spawn.
// Product and behavioral spike use src/pty/spawn.ts; Python only inspects its child.
const script = String.raw`
import os
print("TTY=%s,%s SIZE=%s" % (os.isatty(0), os.isatty(1), os.get_terminal_size(0)), flush=True)
print("PID=%s PGID=%s SID=%s PARENT_PGID=%s PARENT_SID=%s" % (os.getpid(), os.getpgrp(), os.getsid(0), os.getpgid(os.getppid()), os.getsid(os.getppid())), flush=True)
try:
    foreground = os.tcgetpgrp(0)
    assert foreground == os.getpgrp()
    assert os.getsid(0) == os.getpid()
    print("CONTROLLING=true FOREGROUND_PGID=%s" % foreground, flush=True)
except OSError as error:
    print("CONTROLLING=false TCGETPGRP_ERRNO=%s" % error.errno, flush=True)
`;

for (const label of ["plain reusable", "detached reusable", "setsid -c reusable", "inline native"]) {
	let output = "";
	const decoder = new TextDecoder();
	const { promise: eof, resolve } = Promise.withResolvers<void>();
	const options: Bun.TerminalOptions = {
		cols: 80,
		rows: 24,
		data(_terminal, bytes) { output += decoder.decode(bytes, { stream: true }); },
		exit() { output += decoder.decode(); resolve(); },
	};
	const reusable = label === "inline native" ? undefined : new Bun.Terminal(options);
	const command = label === "setsid -c reusable"
		? ["setsid", "-c", "python3", "-u", "-c", script]
		: ["python3", "-u", "-c", script];
	const child = Bun.spawn(command, {
		terminal: reusable ?? options,
		detached: label === "detached reusable",
		env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
	});
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	try {
		const code = await Promise.race([
			child.exited,
			new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error(`${label} exit deadline`)), 5000); }),
		]);
		if (code !== 0) throw new Error(`${label} unexpectedly exited ${code}`);
		const deadline = Date.now() + 5000;
		while (!output.includes("CONTROLLING=")) {
			if (Date.now() >= deadline) throw new Error(`${label} did not emit its result`);
			await Bun.sleep(10);
		}
		const controls = label === "setsid -c reusable" || label === "inline native";
		const expected = controls ? "CONTROLLING=true" : "CONTROLLING=false TCGETPGRP_ERRNO=25";
		if (!output.includes(expected)) throw new Error(`${label}: ${output}`);
		if (label === "inline native") {
			await Promise.race([eof, new Promise<never>((_, reject) => { clearTimeout(watchdog); watchdog = setTimeout(() => reject(new Error("native EOF deadline")), 5000); })]);
			if (!output.includes(`PID=${child.pid} PGID=${child.pid} SID=${child.pid}`) || !output.includes(`FOREGROUND_PGID=${child.pid}`)) throw new Error("inline native ownership differs");
		}
		console.log(`${label} (Bun subprocess pid=${child.pid}, exit=${code}):\n${output.trim()}`);
	} finally {
		clearTimeout(watchdog);
		if (child.exitCode === null) child.kill("SIGKILL");
		await child.exited;
		(reusable ?? child.terminal)?.close();
	}
}
