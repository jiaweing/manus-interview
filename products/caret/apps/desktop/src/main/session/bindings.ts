import type { BoundaryServices } from "../ipc-boundary";
import type { Readiness } from "../tray-hotkey";
import type { TrayCallbacks } from "../tray-runtime";
import type { SessionMachine } from "./machine";

export function sessionTrayCallbacks(
  machine: SessionMachine,
  getReadiness: () => Readiness = () => ({ key: false, microphone: false })
): TrayCallbacks {
  return {
    getReadiness,
    getSessionPhase: machine.getSessionPhase,
    onCancel: () => {
      machine.cancel();
    },
    onToggle: () => {
      machine.activate();
    },
  };
}

export function sessionBoundaryServices(
  machine: SessionMachine
): BoundaryServices {
  return {
    cancel: (sessionId) => {
      machine.cancel(sessionId);
    },
    getActiveSession: machine.getActiveSession,
    getStatus: machine.getStatus,
    // Audio submission and key setup remain unavailable until #11/#15.
  };
}
