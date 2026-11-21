import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Kernel } from "../kernel";
import type { PluginInstaller } from "../kernel/install";
import { ManifestValidationError } from "../kernel/manifest/errors";
import { StateError } from "../kernel/state/errors";
import { parseCommand } from "./commands";
import { CliError, formatError } from "./errors";
import { formatInstallPreview } from "./install";

export interface SessionIO {
	error: Writable;
	home?: string | undefined;
	input: Readable;
	output: Writable;
	terminal: boolean;
}

async function createInstaller(home: string): Promise<PluginInstaller> {
	const { createRegistryStore } = await import("../kernel/state");
	const { PluginInstaller: Installer } = await import("../kernel/install");
	return new Installer(await createRegistryStore(home));
}

async function handleInstall(
	path: string,
	installer: PluginInstaller,
	iterator: AsyncIterator<string>,
	io: SessionIO
): Promise<void> {
	const preview = await installer.preview(path);
	io.output.write(formatInstallPreview(preview));
	const answer = await iterator.next();
	const record = await installer.confirm(
		preview,
		!answer.done && answer.value === "yes"
	);
	io.output.write(
		record
			? `\nInstalled ${record.id} disabled; 0 capabilities registered.\n`
			: "\nInstallation cancelled.\n"
	);
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
	const iterator = lines[Symbol.asyncIterator]();
	let installer: PluginInstaller | undefined;
	const prompt = () => {
		if (io.terminal) {
			io.output.write("patchbay> ");
		}
	};
	try {
		prompt();
		for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
			try {
				const command = parseCommand(line);
				if (command === "exit") {
					break;
				}
				if (command === "help") {
					io.output.write("Commands: help, exit; plugin install <path>\n");
				}
				if (typeof command === "object") {
					installer ??= await createInstaller(
						io.home ?? process.env.HOME ?? ""
					);
					await handleInstall(command.path, installer, iterator, io);
				}
			} catch (error) {
				if (
					error instanceof CliError ||
					error instanceof ManifestValidationError ||
					error instanceof StateError
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
