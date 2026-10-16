import type { StructureChatScope } from "./types.ts";
import type { BackgroundRequest } from "./background-generation.ts";

export interface ProjectRuntimeState {
  running: Set<string>;
  cancelFlags: Set<string>;
  rerunRequests: Set<string>;
  outlineRebuildRequests: Set<string>;
  pageInstructions: Map<string, { draft?: string; design?: string }>;
  activeControllers: Map<string, AbortController>;
  pageMessages: Map<string, Array<{ pageId: string; message: string; surface: "search" | "draft" | "design" }>>;
  structureMessages: Map<string, Array<{ message: string; scope: StructureChatScope; scopeId: string }>>;
  referenceAnalysisRequests: Set<string>;
  backgroundGenerationRequests: Map<string, BackgroundRequest>;
  artifactAuditFingerprints: Map<string, string>;
  projectListeners: Set<(projectId: string) => void>;
}

// Route bundles and hot reloads can evaluate this module independently. The
// global symbol identifies one runtime for the complete local Node process.
const RUNTIME_KEY = Symbol.for("ppt-agent.project-runtime.v1");

export function getProjectRuntimeState(): ProjectRuntimeState {
  const host = globalThis as unknown as Record<symbol, ProjectRuntimeState | undefined>;
  const state = host[RUNTIME_KEY] ??= {
    running: new Set(),
    cancelFlags: new Set(),
    rerunRequests: new Set(),
    outlineRebuildRequests: new Set(),
    pageInstructions: new Map(),
    activeControllers: new Map(),
    pageMessages: new Map(),
    structureMessages: new Map(),
    referenceAnalysisRequests: new Set(),
    backgroundGenerationRequests: new Map(),
    artifactAuditFingerprints: new Map(),
    projectListeners: new Set(),
  };
  state.backgroundGenerationRequests ??= new Map();
  return state;
}

/** A user pause cancels queued restarts; editing can explicitly keep one. */
export function cancelProjectRuntime(projectId: string, preserveQueuedRun = false) {
  const state = getProjectRuntimeState();
  if (!preserveQueuedRun) state.rerunRequests.delete(projectId);
  state.cancelFlags.add(projectId);
  state.activeControllers.get(projectId)?.abort();
}
