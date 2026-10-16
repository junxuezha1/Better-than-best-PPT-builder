import { getProjectRuntimeState } from "./runtime-state.ts";

type Listener = (projectId: string) => void;

const listeners = getProjectRuntimeState().projectListeners;

export function emitProjectChange(projectId: string) {
  for (const listener of listeners) {
    listener(projectId);
  }
}

export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
