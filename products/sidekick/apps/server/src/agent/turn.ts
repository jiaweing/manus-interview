import {
	type TurnRequest,
	type TurnResponse,
	turnResponseSchema,
} from "../../../../packages/protocol/src";
import type { TurnAdapter } from "./app";

export const MODEL_DEADLINE_MS = 20_000;

export class ModelProtocolError extends Error {}
export class ModelDeadlineError extends Error {}
export class TurnAbortedError extends Error {}
export class ModelUnavailableError extends Error {}

/** Enforce the deadline even when an injected adapter ignores abort. */
export async function runModelTurn(
	adapter: TurnAdapter,
	request: TurnRequest,
	requestSignal: AbortSignal,
	deadlineMs = MODEL_DEADLINE_MS
): Promise<TurnResponse> {
	const controller = new AbortController();
	let rejectAbort: (reason: Error) => void = () => undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = (error: Error) => {
		rejectAbort(error);
		controller.abort();
	};
	const onRequestAbort = () => abort(new TurnAbortedError());
	const timer = setTimeout(() => abort(new ModelDeadlineError()), deadlineMs);
	requestSignal.addEventListener("abort", onRequestAbort, { once: true });
	try {
		if (requestSignal.aborted) {
			throw new TurnAbortedError();
		}
		const result = await Promise.race([
			aborted,
			adapter.turn(request, controller.signal),
		]);
		if (requestSignal.aborted) {
			throw new TurnAbortedError();
		}
		const parsed = turnResponseSchema.safeParse(result);
		if (!parsed.success) {
			throw new ModelProtocolError();
		}
		const callId = parsed.data.toolCall?.id;
		if (
			callId &&
			request.messages.some(
				(message) =>
					message.role === "assistant" && message.toolCall?.id === callId
			)
		) {
			throw new ModelProtocolError();
		}
		return parsed.data;
	} finally {
		clearTimeout(timer);
		requestSignal.removeEventListener("abort", onRequestAbort);
	}
}
