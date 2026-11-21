import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Kernel } from "../kernel";
import { parseCommand } from "./commands";
import { CliError, ERROR_CODES, formatError } from "./errors";

export interface SessionIO {
	error: Writable;
	input: Readable;
	output: Writable;
	terminal: boolean;
}

export async function runSession(kernel: Kernel, io: SessionIO): Promise<void> {
	io.output.write(
		`Patchbay ready: ${kernel.tools.size} tools, ${kernel.providers.size} providers.\n`
	);
	io.output.write(
		'Type "help" for commands; "exit" or EOF ends the session.\n'
	);
	const lines = createInterface({
		crlfDelay: Number.POSITIVE_INFINITY,
		input: io.input,
		terminal: false,
	});
	const prompt = () => {
		if (io.terminal) {
			io.output.write("patchbay> ");
		}
	};

	try {
		prompt();
		for await (const line of lines) {
			try {
				const command = parseCommand(line);
				if (command === "exit") {
					break;
				}
				if (command === "help") {
					io.output.write("Commands: help, exit\n");
				}
			} catch (error) {
				if (
					error instanceof CliError &&
					error.code === ERROR_CODES.UNKNOWN_COMMAND
				) {
					io.error.write(formatError(error));
				} else {
					throw error;
				}
			}
			prompt();
		}
	} finally {
		lines.close();
		if (io.terminal) {
			io.output.write("\n");
		}
	}
}
