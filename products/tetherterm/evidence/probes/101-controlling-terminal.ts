// Standalone diagnostic only. The product and spike use src/pty/spawn.ts.
// Intentionally compares the rejected plain/detached attachment with setsid -c.
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

for (const label of ["plain", "detached", "setsid -c"]) {
	let output = "";
	const decoder = new TextDecoder();
	const terminal = new Bun.Terminal({
		cols: 80,
		rows: 24,
		data(_terminal, bytes) {
			output += decoder.decode(bytes, { stream: true });
		},
	});
	const command = label === "setsid -c"
		? ["setsid", "-c", "python3", "-u", "-c", script]
		: ["python3", "-u", "-c", script];
	const child = Bun.spawn(command, {
		terminal,
		detached: label === "detached",
		env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
	});
	const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
	try {
		const code = await child.exited;
		if (code !== 0) throw new Error(`${label} unexpectedly exited ${code}`);
		const deadline = Date.now() + 5000;
		while (!output.includes("CONTROLLING=")) {
			if (Date.now() >= deadline) throw new Error(`${label} did not emit its result`);
			await Bun.sleep(10);
		}
		const expected = label === "setsid -c" ? "CONTROLLING=true" : "CONTROLLING=false TCGETPGRP_ERRNO=25";
		if (!output.includes(expected)) throw new Error(`${label}: ${output}`);
		console.log(`${label} (Bun subprocess pid=${child.pid}, exit=${code}):\n${output.trim()}`);
	} finally {
		clearTimeout(watchdog);
		if (child.exitCode === null) child.kill("SIGKILL");
		await child.exited;
		terminal.close();
	}
}
