import { actionSchema } from "../../../packages/protocol/src";
import { contentScriptInjection } from "../utils/content-script";
import {
	type DispatchResult,
	dispatchResultSchema,
	invalidAction,
	type RunBinding,
	runBindingSchema,
	staleTarget,
	unavailableDispatch,
} from "./page/dispatch";
import type { SnapshotBrowser } from "./snapshot-client";

type DispatchBrowser = Pick<SnapshotBrowser, "scripting" | "tabs">;

/** Construct in the visible panel. Run binding comes from local state, never the model. */
export function createActionDispatcher(api: DispatchBrowser) {
	let active: RunBinding | undefined;
	return {
		async bindRun(
			input: unknown
		): Promise<DispatchResult | { status: "ready" }> {
			const parsed = runBindingSchema.safeParse(input);
			if (!parsed.success) {
				return invalidAction();
			}
			const binding = parsed.data;
			active = binding;
			try {
				await api.scripting.executeScript(
					contentScriptInjection(binding.tabId)
				);
				if (active !== binding) {
					return staleTarget("inactive-run");
				}
				const response = await api.tabs.sendMessage(
					binding.tabId,
					{ binding, type: "sidekick:bind-run" },
					{ frameId: 0 }
				);
				if (active !== binding) {
					return staleTarget("inactive-run");
				}
				if (
					response &&
					typeof response === "object" &&
					"status" in response &&
					response.status === "ready"
				) {
					return { status: "ready" };
				}
				active = undefined;
				const result = dispatchResultSchema.safeParse(response);
				return result.success ? result.data : unavailableDispatch();
			} catch {
				if (active === binding) {
					active = undefined;
				}
				return unavailableDispatch();
			}
		},
		async dispatch(input: unknown): Promise<DispatchResult> {
			const parsed = actionSchema.safeParse(input);
			if (!parsed.success) {
				return invalidAction();
			}
			const action = parsed.data;
			const binding = active;
			if (!binding || action.runId !== binding.runId) {
				return staleTarget("inactive-run");
			}
			if (action.tabId !== binding.tabId) {
				return staleTarget("tab-changed");
			}
			try {
				// A fixed file in the isolated top frame, never func/args from a model.
				await api.scripting.executeScript(contentScriptInjection(action.tabId));
				if (active !== binding) {
					return staleTarget("inactive-run");
				}
				const response = await api.tabs.sendMessage(
					action.tabId,
					{ action, type: "sidekick:dispatch" },
					{ frameId: 0 }
				);
				const result = dispatchResultSchema.safeParse(response);
				return result.success ? result.data : unavailableDispatch();
			} catch {
				// Injection/navigation/transport failures are uncertain; never retry.
				return unavailableDispatch();
			}
		},
	};
}
