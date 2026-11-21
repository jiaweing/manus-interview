import { CliError, ERROR_CODES } from "./errors";

export type Command = "empty" | "help" | "exit";

export function parseCommand(line: string): Command {
	const command = line.trim();
	if (command === "") {
		return "empty";
	}
	if (command === "help" || command === "exit") {
		return command;
	}
	throw new CliError(
		ERROR_CODES.UNKNOWN_COMMAND,
		'Unknown command. Type "help" for available commands.'
	);
}
