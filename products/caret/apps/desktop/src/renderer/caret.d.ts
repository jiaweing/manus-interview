import type { CaretApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    readonly caret: CaretApi;
  }
}
