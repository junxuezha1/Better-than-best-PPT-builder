import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ProjectRuntimeState } from "../src/lib/runtime-state.ts";

async function independentRuntime(label: string) {
  return import(new URL(`../src/lib/runtime-state.ts?route=${label}-${randomUUID()}`, import.meta.url).href) as Promise<typeof import("../src/lib/runtime-state.ts")>;
}

function cleanup(state: ProjectRuntimeState, id: string) {
  state.running.delete(id);
  state.cancelFlags.delete(id);
  state.rerunRequests.delete(id);
  state.outlineRebuildRequests.delete(id);
  state.pageInstructions.delete(id);
  state.activeControllers.delete(id);
  state.pageMessages.delete(id);
  state.structureMessages.delete(id);
  state.referenceAnalysisRequests.delete(id);
  state.backgroundGenerationRequests.delete(id);
  state.artifactAuditFingerprints.delete(id);
}

test("independently evaluated route modules share worker ownership and all pending state", async () => {
  const first = await independentRuntime("create");
  const second = await independentRuntime("project-get");
  assert.notEqual(first.getProjectRuntimeState, second.getProjectRuntimeState, "test must evaluate two separate module copies");
  const creator = first.getProjectRuntimeState();
  const reader = second.getProjectRuntimeState();
  const id = randomUUID();
  try {
    creator.running.add(id);
    creator.cancelFlags.add(id);
    creator.rerunRequests.add(id);
    creator.outlineRebuildRequests.add(id);
    creator.pageInstructions.set(id, { design: "保留原图" });
    creator.pageMessages.set(id, [{ pageId: "page-1", message: "修改标题", surface: "draft" }]);
    creator.structureMessages.set(id, [{ message: "交换页序", scope: "deck", scopeId: "" }]);
    creator.referenceAnalysisRequests.add(id);
    creator.backgroundGenerationRequests.set(id, { mode: "plan", brief: "按内容生成" });
    creator.artifactAuditFingerprints.set(id, "verified");
    assert.equal(reader.running.has(id), true, "GET must see the existing worker instead of starting another");
    for (const key of ["running", "cancelFlags", "rerunRequests", "outlineRebuildRequests", "pageInstructions", "activeControllers", "pageMessages", "structureMessages", "referenceAnalysisRequests", "backgroundGenerationRequests", "artifactAuditFingerprints", "projectListeners"] as const) {
      assert.equal(reader[key], creator[key], `${key} must survive route bundling / hot reload`);
    }
  } finally {
    cleanup(creator, id);
  }
});

test("pause from another route aborts the active call and cancels a queued restart", async () => {
  const workerRoute = await independentRuntime("worker");
  const actionRoute = await independentRuntime("pause");
  const state = workerRoute.getProjectRuntimeState();
  const id = randomUUID();
  const controller = new AbortController();
  try {
    state.running.add(id);
    state.activeControllers.set(id, controller);
    state.rerunRequests.add(id);
    state.pageMessages.set(id, [{ pageId: "page-1", message: "尚未执行的改稿", surface: "draft" }]);
    let aborted = false;
    controller.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    actionRoute.cancelProjectRuntime(id);
    assert.equal(aborted, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(state.cancelFlags.has(id), true);
    assert.equal(state.rerunRequests.has(id), false, "pause must not be undone by a queued restart");
    assert.equal(state.running.has(id), true, "keep worker ownership until its finally block releases it");
    assert.equal(state.pageMessages.get(id)?.length, 1, "retain pending edits for an explicit resume");
  } finally {
    cleanup(state, id);
  }
});

test("edit replacement aborts the old call while preserving its queued rerun", async () => {
  const workerRoute = await independentRuntime("worker-edit");
  const editRoute = await independentRuntime("edit");
  const state = workerRoute.getProjectRuntimeState();
  const id = randomUUID();
  const controller = new AbortController();
  try {
    state.activeControllers.set(id, controller);
    state.rerunRequests.add(id);
    editRoute.cancelProjectRuntime(id, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(state.rerunRequests.has(id), true);
    editRoute.cancelProjectRuntime(id);
    assert.equal(state.rerunRequests.has(id), false, "a subsequent user pause wins over the pending edit restart");
  } finally {
    cleanup(state, id);
  }
});

test("SSE listener receives and unsubscribes from changes emitted by a different route bundle", async () => {
  const subscribeRoute = await import(new URL(`../src/lib/events-bus.ts?route=sse-${randomUUID()}`, import.meta.url).href) as typeof import("../src/lib/events-bus.ts");
  const mutationRoute = await import(new URL(`../src/lib/events-bus.ts?route=mutation-${randomUUID()}`, import.meta.url).href) as typeof import("../src/lib/events-bus.ts");
  assert.notEqual(subscribeRoute.emitProjectChange, mutationRoute.emitProjectChange);
  const id = randomUUID();
  const received: string[] = [];
  const unsubscribe = subscribeRoute.onProjectChange((projectId) => received.push(projectId));
  try {
    mutationRoute.emitProjectChange(id);
    assert.deepEqual(received, [id]);
    unsubscribe();
    mutationRoute.emitProjectChange(id);
    assert.deepEqual(received, [id]);
  } finally {
    unsubscribe();
  }
});
