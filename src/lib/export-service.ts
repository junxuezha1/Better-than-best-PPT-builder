import { createHash } from "node:crypto";
import {
  parseExportMode,
  PptxExportError,
  type PptxExportMode,
  type PptxExportResult,
  type PptxSlideInput,
} from "./export-types.ts";
import type { PageRow, ProjectRow } from "./types.ts";

type ExportProject = Pick<ProjectRow, "id" | "title">;
type ExportPage = Pick<
  PageRow,
  "id" | "project_id" | "sort_order" | "title" | "speaker_notes" | "design_svg" | "design_status"
>;

export interface ExportDependencies {
  getProject: (id: string) => ExportProject | null | undefined;
  auditProjectArtifacts: (id: string, signal?: AbortSignal) => unknown | Promise<unknown>;
  listPages: (id: string) => ExportPage[];
  pageMetadata?: (projectId: string, pageId: string) => { hidden?: boolean } | null;
  buildPptxDetailed: (
    slides: PptxSlideInput[],
    options: { mode?: PptxExportMode; title?: string },
    signal?: AbortSignal,
  ) => Promise<PptxExportResult>;
}

interface ExportServiceOptions {
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  maxPendingExports?: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_MODE: "导出模式不支持，请选择可编辑 PPTX 或高保真 PPTX",
  INVALID_SVG: "设计稿内容损坏或无法解析，请重新生成对应页面后再导出",
  INVALID_CANVAS: "设计稿画布必须为 1280×720（16:9），请重新生成对应页面后再导出",
  UNSAFE_SVG: "设计稿包含不允许的脚本或外部资源，请重新生成对应页面后再导出",
  SVG_LIMIT: "设计稿超出大小、图片或元素数量限制，请简化复杂内容后重试",
  RESOURCE_LIMIT: "设计稿超出导出资源限制，请减少页面或简化复杂内容后重试",
  EXPORT_FAILED: "PPTX 导出失败，请重试或选择高保真 PPTX",
  EXPORT_BUSY: "导出任务较多，请稍后重试",
  EXPORT_TIMEOUT: "导出处理超时，请减少页面或简化复杂内容后重试",
  EXPORT_CANCELLED: "导出已取消",
  EXPORT_STALE: "项目内容已变化，请重新导出",
};

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function exportFailure(error: unknown): Response {
  if (error instanceof PptxExportError) {
    // Only application-owned messages cross the HTTP boundary; exception text
    // can contain paths, XML fragments, or errors from third-party libraries.
    const code = Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : "EXPORT_FAILED";
    const status = code === "EXPORT_FAILED"
      ? 500
      : Math.min(599, Math.max(400, Number.isInteger(error.status) ? error.status : 422));
    const page = error.message.match(/^第 (\d{1,3}) 页[：:]/)?.[1];
    return jsonError(code, `${page ? `第 ${page} 页：` : ""}${ERROR_MESSAGES[code]}`, status);
  }
  return jsonError("EXPORT_FAILED", ERROR_MESSAGES.EXPORT_FAILED, 500);
}

function filenameStem(title: string): string {
  let stem = Buffer.from(title, "utf8").toString("utf8")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\/:*?"<>|]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  // Bound UTF-8 bytes, without splitting a surrogate pair or encoded character.
  let bounded = "";
  for (const character of stem) {
    if (Buffer.byteLength(bounded + character, "utf8") > 160) break;
    bounded += character;
  }
  stem = bounded.replace(/[.\s]+$/g, "") || "ppt-agent";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem;
}

function downloadDisposition(title: string, mode: PptxExportMode): string {
  const stem = filenameStem(title);
  const filename = `${stem}-${mode}.pptx`;
  const ascii = stem.replace(/[^A-Za-z0-9 _().-]/g, "_").replace(/^[_\s]+|[_\s]+$/g, "") || "ppt-agent";
  const encoded = encodeURIComponent(filename)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}-${mode}.pptx"; filename*=UTF-8''${encoded}`;
}

/** Each request exports its audited immutable snapshot, including when queued.
 * A later request always reads again and hashes actual content, so timestamps or
 * an earlier in-flight version cannot make it reuse a stale deck.
 */
export function createExportHandler(dependencies: ExportDependencies, options: ExportServiceOptions = {}) {
  const maxEntries = Math.max(0, options.maxCacheEntries ?? 8);
  const maxBytes = Math.max(0, options.maxCacheBytes ?? 64 * 1024 * 1024);
  const maxPending = Math.max(1, options.maxPendingExports ?? 16);
  const cache = new Map<string, { result: PptxExportResult; size: number }>();
  type SharedTask = { promise: Promise<PptxExportResult>; controller: AbortController; consumers: number };
  const pending = new Map<string, SharedTask>();
  const projectTails = new Map<string, Promise<PptxExportResult>>();
  let cacheBytes = 0;

  function remember(key: string, result: PptxExportResult) {
    const size = result.buffer.byteLength + Buffer.byteLength(JSON.stringify(result.warnings), "utf8");
    if (size > maxBytes || maxEntries === 0) return;
    cache.set(key, { result, size });
    cacheBytes += size;
    while (cache.size > maxEntries || cacheBytes > maxBytes) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].size;
    }
  }

  function build(projectId: string, key: string, slides: PptxSlideInput[], mode: PptxExportMode, title: string, signal: AbortSignal): Promise<PptxExportResult> | undefined {
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return Promise.resolve(cached.result);
    }
    const existing = pending.get(key);
    if (existing) return subscribe(existing, signal);
    if (pending.size >= maxPending) return undefined;

    const shared: SharedTask = { promise: undefined!, controller: new AbortController(), consumers: 0 };
    const previous = projectTails.get(projectId);
    const task = Promise.resolve(previous).catch(() => undefined)
      .then(() => {
        if (shared.controller.signal.aborted) throw new PptxExportError("导出已取消", "EXPORT_CANCELLED", 499);
        return dependencies.buildPptxDetailed(slides, { mode, title }, shared.controller.signal);
      })
      .then((result) => {
        remember(key, result);
        return result;
      })
      .finally(() => {
        pending.delete(key);
        if (projectTails.get(projectId) === task) projectTails.delete(projectId);
      });
    shared.promise = task;
    pending.set(key, shared);
    projectTails.set(projectId, task);
    return subscribe(shared, signal);
  }

  function subscribe(task: SharedTask, signal: AbortSignal): Promise<PptxExportResult> {
    task.consumers += 1;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, value?: PptxExportResult) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", abort);
        task.consumers -= 1;
        if (task.consumers === 0) task.controller.abort();
        if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(new PptxExportError("导出已取消", "EXPORT_CANCELLED", 499));
      task.promise.then(value => finish(undefined, value), error => finish(error));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  return async function handleExport(request: Request, projectId: string): Promise<Response> {
    try {
      const mode = parseExportMode(new URL(request.url).searchParams.get("mode"));
      let project: ExportProject | null | undefined;
      try {
        project = dependencies.getProject(projectId);
      } catch (error) {
        // The existing store uses this specific error for missing projects.
        if (!(error instanceof Error) || error.message !== "项目不存在") throw error;
      }
      if (!project) return jsonError("PROJECT_NOT_FOUND", "项目不存在", 404);

      if (request.signal.aborted) throw new PptxExportError("导出已取消", "EXPORT_CANCELLED", 499);
      await dependencies.auditProjectArtifacts(projectId, request.signal);
      if (request.signal.aborted) throw new PptxExportError("导出已取消", "EXPORT_CANCELLED", 499);
      project = dependencies.getProject(projectId);
      if (!project) return jsonError("PROJECT_NOT_FOUND", "项目不存在", 404);
      const pages = dependencies.listPages(projectId).map((page) => ({ ...page }))
        .sort((left, right) => left.sort_order - right.sort_order);
      if (pages.some((page) => page.project_id !== projectId || !Number.isFinite(page.sort_order))) {
        return jsonError("INVALID_PAGE_ORDER", "项目页面信息不完整，请刷新项目后重试", 409);
      }
      const incomplete = pages.filter((page) => page.design_status !== "ready" || !page.design_svg.trim());
      if (!pages.length || incomplete.length) {
        return jsonError("DESIGN_NOT_READY", !pages.length
          ? "项目还没有页面"
          : `还有 ${incomplete.length} 页设计稿未完成，暂不能导出`, 409);
      }

      const title = project.title;
      const slides = pages.map((page) => ({
        svg: page.design_svg, title: page.title, notes: page.speaker_notes,
        ...(dependencies.pageMetadata ? { hidden: dependencies.pageMetadata(projectId, page.id)?.hidden === true } : {}),
      }));
      const fingerprint = createHash("sha256").update(JSON.stringify({
        mode, title, pages: pages.map((page) => [page.id, page.sort_order]), slides,
      })).digest("hex");
      const resultPromise = build(projectId, `${projectId}:${fingerprint}`, slides, mode, title, request.signal);
      if (!resultPromise) return jsonError("EXPORT_BUSY", "导出任务较多，请稍后重试", 429);
      const result = await resultPromise;
      return new Response(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": downloadDisposition(title, mode),
          "Cache-Control": "no-store",
          "X-PPTX-Mode": mode,
          "X-PPTX-Fallback-Count": String(result.warnings.length),
          "X-PPTX-Fallback-Slides": [...new Set(result.warnings.map(warning => warning.slide))].sort((a, b) => a - b).join(","),
        },
      });
    } catch (error) {
      return exportFailure(error);
    }
  };
}
