import { z } from "zod";
import { type Action, actionSchema } from "../../../../packages/protocol/src";
import {
	isEnabled,
	isRendered,
	type Snapshot,
	type SnapshotObserver,
} from "./snapshot";

export const runBindingSchema = actionSchema.options[0].pick({
	documentToken: true,
	runId: true,
	snapshotId: true,
	tabId: true,
});
export type RunBinding = z.infer<typeof runBindingSchema>;

export const dispatchResultSchema = z.discriminatedUnion("status", [
	z.strictObject({
		reason: z.enum([
			"inactive-run",
			"tab-changed",
			"snapshot-changed",
			"document-changed",
			"unknown-index",
			"target-changed",
			"duplicate-action",
		]),
		reobserveRequired: z.literal(true),
		status: z.literal("stale-target"),
	}),
	z.strictObject({
		reason: z.literal("malformed-envelope"),
		reobserveRequired: z.literal(true),
		status: z.literal("invalid-action"),
	}),
	z.strictObject({
		actionId: z.string(),
		reobserveRequired: z.literal(true),
		runId: z.string(),
		status: z.literal("dispatched"),
	}),
	z.strictObject({
		reobserveRequired: z.literal(false),
		status: z.literal("unsupported-tool"),
	}),
	z.strictObject({
		reason: z.literal("dispatch-unavailable"),
		reobserveRequired: z.literal(true),
		status: z.literal("unverified"),
	}),
]);
export type DispatchResult = z.infer<typeof dispatchResultSchema>;
type StaleReason = Extract<
	DispatchResult,
	{ status: "stale-target" }
>["reason"];
export const staleTarget = (reason: StaleReason): DispatchResult => ({
	reason,
	reobserveRequired: true,
	status: "stale-target",
});
export const invalidAction = (): DispatchResult => ({
	reason: "malformed-envelope",
	reobserveRequired: true,
	status: "invalid-action",
});
export const unavailableDispatch = (): DispatchResult => ({
	reason: "dispatch-unavailable",
	reobserveRequired: true,
	status: "unverified",
});

/** Trusted, packaged code only. Tool implementations and safety policy belong to #84–#87. */
export type PageActionExecutor = (
	action: Action,
	target: Element | null
) => void;

interface RecordedTarget {
	element: Element;
	identity: string;
	next: Element | null;
	parent: Element | null;
	previous: Element | null;
}

const whitespace = /\s+/;

// Local-only identity; never serialize it into a provider payload or result.
function identity(element: Element): string {
	const document = element.ownerDocument;
	const labels =
		"labels" in element
			? Array.from(
					(element.labels as NodeListOf<HTMLLabelElement> | null) ?? []
				).map((label) => [label.textContent, isRendered(label)])
			: [];
	const references = (element.getAttribute("aria-labelledby") ?? "")
		.split(whitespace)
		.map((id) => {
			const label = document.getElementById(id);
			return label ? [label.textContent, isRendered(label)] : null;
		});
	const form =
		"form" in element
			? (element.form as HTMLFormElement | null)
			: element.closest("form");
	return JSON.stringify([
		document.baseURI,
		element.namespaceURI,
		element.localName,
		Array.from(element.attributes, (attribute) => [
			attribute.name,
			attribute.value,
		]).sort(),
		element.textContent,
		labels,
		references,
		element.localName === "a" ? (element as HTMLAnchorElement).href : null,
		form?.action,
		form?.method,
		form?.target,
	]);
}

function retainsIdentity(
	target: Element | null,
	recorded: RecordedTarget
): target is Element {
	return (
		!!target &&
		target === recorded.element &&
		isRendered(target) &&
		isEnabled(target) &&
		identity(target) === recorded.identity &&
		target.parentElement === recorded.parent &&
		target.previousElementSibling === recorded.previous &&
		target.nextElementSibling === recorded.next
	);
}

/** Synchronous preflight + executor call: no await, index re-enumeration or selector fallback. */
export function createPageDispatcher(
	document: Document,
	observer: SnapshotObserver,
	execute?: PageActionExecutor
) {
	let snapshot: Snapshot | undefined;
	let root: Element | undefined;
	let activeRun: { runId: string; tabId: number } | undefined;
	const consumed = new Set<string>();
	let targets = new Map<number, RecordedTarget>();

	function checkSnapshot(binding: RunBinding): StaleReason | undefined {
		if (!snapshot || binding.tabId !== snapshot.tabId) {
			return "tab-changed";
		}
		if (
			root !== document.documentElement ||
			binding.documentToken !== snapshot.documentToken ||
			snapshot.url !== document.URL
		) {
			return "document-changed";
		}
		if (
			binding.snapshotId !== snapshot.snapshotId ||
			!observer.matchesSnapshot(binding.snapshotId, binding.documentToken)
		) {
			return "snapshot-changed";
		}
	}

	function resolveTarget(
		action: Action
	): { target: Element | null } | { reason: StaleReason } {
		if (action.tool !== "click" && action.tool !== "fill") {
			return { target: null };
		}
		const recorded = targets.get(action.args.index);
		if (!recorded) {
			return { reason: "unknown-index" };
		}
		const target = observer.resolveElement(
			action.snapshotId,
			action.documentToken,
			action.args.index
		);
		return retainsIdentity(target, recorded)
			? { target }
			: { reason: "target-changed" };
	}

	return {
		bindRun(input: unknown): DispatchResult | { status: "ready" } {
			const parsed = runBindingSchema.safeParse(input);
			if (!parsed.success) {
				return invalidAction();
			}
			const reason = checkSnapshot(parsed.data);
			if (reason) {
				return staleTarget(reason);
			}
			if (activeRun?.runId !== parsed.data.runId) {
				consumed.clear();
			}
			activeRun = { runId: parsed.data.runId, tabId: parsed.data.tabId };
			return { status: "ready" };
		},
		dispatch(input: unknown): DispatchResult {
			const parsed = actionSchema.safeParse(input);
			if (!parsed.success) {
				return invalidAction();
			}
			const action = parsed.data;
			if (!activeRun || action.runId !== activeRun.runId) {
				return staleTarget("inactive-run");
			}
			if (action.tabId !== activeRun.tabId) {
				return staleTarget("tab-changed");
			}
			const reason = checkSnapshot(action);
			if (reason) {
				return staleTarget(reason);
			}
			if (consumed.has(action.actionId)) {
				return staleTarget("duplicate-action");
			}
			const resolved = resolveTarget(action);
			if ("reason" in resolved) {
				return staleTarget(resolved.reason);
			}
			if (!execute) {
				return { reobserveRequired: false, status: "unsupported-tool" };
			}
			// Consume before calling: an uncertain exception must never replay a mutation.
			consumed.add(action.actionId);
			try {
				execute(action, resolved.target);
				return {
					actionId: action.actionId,
					reobserveRequired: true,
					runId: action.runId,
					status: "dispatched",
				};
			} catch {
				return unavailableDispatch();
			}
		},
		observe(tabId: number): Snapshot {
			const observed = observer.observe(tabId);
			snapshot = observed;
			root = document.documentElement;
			targets = new Map();
			for (const descriptor of observed.elements) {
				const element = observer.resolveElement(
					observed.snapshotId,
					observed.documentToken,
					descriptor.index
				);
				if (element) {
					targets.set(descriptor.index, {
						element,
						identity: identity(element),
						next: element.nextElementSibling,
						parent: element.parentElement,
						previous: element.previousElementSibling,
					});
				}
			}
			return observed;
		},
	};
}

export type PageDispatcher = ReturnType<typeof createPageDispatcher>;
