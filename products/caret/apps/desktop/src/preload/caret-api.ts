import {
  type BoundaryRequest,
  type BoundaryResult,
  type CaretApi,
  type CaretStatus,
  IPC_REQUEST_CHANNEL,
  IPC_STATUS_CHANNEL,
} from "../shared/ipc-contract";

// Kept private in preload; contextBridge receives only the four-method facade.
export interface PreloadTransport {
  invoke(channel: string, request: BoundaryRequest): Promise<BoundaryResult>;
  on(
    channel: string,
    listener: (event: unknown, status: CaretStatus) => void
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: unknown, status: CaretStatus) => void
  ): unknown;
}

export function createCaretApi(transport: PreloadTransport): CaretApi {
  return Object.freeze<CaretApi>({
    cancel: (sessionId) =>
      transport.invoke(IPC_REQUEST_CHANNEL, {
        operation: "cancel",
        payload: { sessionId },
      }),
    setupKey: (key) =>
      transport.invoke(IPC_REQUEST_CHANNEL, {
        operation: "setupKey",
        payload: { key },
      }),
    submitAudio: (submission) =>
      transport.invoke(IPC_REQUEST_CHANNEL, {
        operation: "submitAudio",
        payload: {
          audio: submission.audio,
          mimeType: submission.mimeType,
          sessionId: submission.sessionId,
        },
      }),
    subscribeStatus(listener) {
      let active = true;
      let receivedUpdate = false;
      const notify = (_event: unknown, status: CaretStatus) => {
        if (active) {
          receivedUpdate = true;
          listener({ sessionId: status.sessionId, state: status.state });
        }
      };
      transport.on(IPC_STATUS_CHANNEL, notify);
      transport
        .invoke(IPC_REQUEST_CHANNEL, {
          operation: "subscribeStatus",
          payload: {},
        })
        .then(
          (result) => {
            if (active && !receivedUpdate && result.ok && result.status) {
              listener({
                sessionId: result.status.sessionId,
                state: result.status.state,
              });
            }
          },
          () => {
            // A closed window or rejected subscription must not produce an unhandled promise.
          }
        );
      return () => {
        active = false;
        transport.removeListener(IPC_STATUS_CHANNEL, notify);
      };
    },
  });
}
