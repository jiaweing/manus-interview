import { CliError, ERROR_CODES } from "./errors";

export type Command =
	| "empty"
	| "help"
	| "exit"
	| { kind: "install"; path: string };

export function parseCommand(line: string): Command {
	const command = line.trim();
	if (command === "") {
		return "empty";
	}
	if (command === "help" || command === "exit") {
		return command;
	}
	if (command.startsWith("plugin install ")) {
		const path = command.slice("plugin install ".length).trim();
		if (path) {
			return { kind: "install", path };
		}
	}
	throw new CliError(
		ERROR_CODES.UNKNOWN_COMMAND,
		'Unknown command. Type "help" for available commands.'
	);
}
