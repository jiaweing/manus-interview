import type { ModelId } from "../../shared/model-contract";
import type { BoundaryServices } from "../ipc-boundary";
import { ModelManager } from "./model-manager";

export function createModelServices(userData: string): {
  services: Pick<
    BoundaryServices,
    "modelStatus" | "startModel" | "cancelModel"
  >;
  manager: ModelManager;
} {
  const manager = new ModelManager({ userData });
  return {
    manager,
    services: {
      async cancelModel(id: ModelId) {
        await manager.cancel(id);
        return manager.status(id);
      },
      modelStatus: (id: ModelId) => manager.status(id),
      startModel(id: ModelId) {
        // IPC acknowledges starting promptly; status polls receive progress/failure.
        // Consume the background rejection; only bounded public metadata is exposed.
        manager.start(id).catch(() => {
          /* Reported by the model status API. */
        });
        return manager.status(id);
      },
    },
  };
}
