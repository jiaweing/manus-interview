export const MODEL_IDS = ["whisper-small", "whisper-medium"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

// No URL, path, exception message, audio, or credential crosses the boundary.
export type ModelStatus =
  | { modelId: string; state: "absent" | "ready" | "failed" }
  | { modelId: string; state: "downloading"; percent: number };

export function publicModelStatus(status: ModelStatus): ModelStatus {
  return status.state === "downloading"
    ? { modelId: status.modelId, percent: status.percent, state: status.state }
    : { modelId: status.modelId, state: status.state };
}
