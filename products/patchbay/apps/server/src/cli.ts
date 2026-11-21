import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { CliError, ERROR_CODES, EXIT_CODES, formatError } from "./cli/errors";
import { runSession, type SessionIO } from "./cli/session";
import { createKernel } from "./kernel";

export interface CliOptions extends SessionIO {
	home: string | undefined;
	platform: string;
}

async function validateStartup(options: CliOptions): Promise<void> {
	if (options.platform !== "linux") {
		throw new CliError(
			ERROR_CODES.UNSUPPORTED_PLATFORM,
			"The foreground CLI requires Linux."
		);
	}
	const { home } = options;
	if (!(home && isAbsolute(home) && (await stat(home)).isDirectory())) {
		throw new CliError(
			ERROR_CODES.STARTUP_FAILED,
			"HOME must name an existing absolute directory."
		);
	}
}

export async function main(
	options: CliOptions = {
		error: process.stderr,
		home: process.env.HOME,
		input: process.stdin,
		output: process.stdout,
		platform: process.platform,
		terminal: Boolean(process.stdin.isTTY),
	}
): Promise<number> {
	try {
		await validateStartup(options);
	} catch (error) {
		options.error.write(
			formatError(
				error instanceof CliError
					? error
					: new CliError(
							ERROR_CODES.STARTUP_FAILED,
							"HOME must name an existing absolute directory."
						)
			)
		);
		return EXIT_CODES.STARTUP;
	}

	try {
		await runSession(createKernel(), options);
		return EXIT_CODES.OK;
	} catch {
		options.error.write(
			formatError(
				new CliError(
					ERROR_CODES.SESSION_FAILED,
					"The foreground session failed."
				)
			)
		);
		return EXIT_CODES.FATAL;
	}
}

if (import.meta.main) {
	process.exitCode = await main();
}
