/** The kernel has no built-in tools, providers, network clients, or workers. */
export function createKernel() {
	return {
		providers: new Map<string, unknown>(),
		tools: new Map<string, unknown>(),
	};
}

export type Kernel = ReturnType<typeof createKernel>;
