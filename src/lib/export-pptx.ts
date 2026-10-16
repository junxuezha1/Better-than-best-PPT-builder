import { getExportWorkerPool } from "./export-worker-pool.ts";
import { PptxExportError, parseExportMode } from "./export-types.ts";
import type { PptxExportMode, PptxExportResult, PptxSlideInput } from "./export-types.ts";

export interface PptxBuildOptions { mode?: PptxExportMode; title?: string }

/** This public entry point never imports a parser, renderer or PPTX packager.
 * Worker sources are traced explicitly by Next; Node >=22.18 runs their TS.
 */
export async function buildPptxDetailed(
  inputs: Array<PptxSlideInput | string>, options: PptxBuildOptions = {}, signal?: AbortSignal,
): Promise<PptxExportResult> {
  const mode = parseExportMode(options.mode);
  if (!inputs.length) throw new PptxExportError("没有可导出的设计稿", "INVALID_SVG");
  if (inputs.length > 80) throw new PptxExportError("一次最多导出 80 页", "SVG_LIMIT");
  if (inputs.reduce((bytes, input) => bytes + Buffer.byteLength(typeof input === "string" ? input : input.svg), 0) > 40 * 1024 * 1024) {
    throw new PptxExportError("整份设计稿不能超过 40MB", "SVG_LIMIT");
  }
  const slides = inputs.map(input => typeof input === "string" ? { svg: input } : { svg: input.svg, title: input.title, notes: input.notes, hidden: input.hidden });
  const metadataBytes = Buffer.byteLength(options.title ?? "") + slides.reduce((bytes, input) => bytes + Buffer.byteLength(input.title ?? "") + Buffer.byteLength(input.notes ?? ""), 0);
  if (metadataBytes > 1024 * 1024) throw new PptxExportError("标题与演讲备注不能超过 1MB", "SVG_LIMIT");
  return getExportWorkerPool().run<PptxExportResult>({ kind: "export", inputs: slides, options: { mode, title: options.title } }, signal);
}

/** Retains the previous Buffer-returning API. */
export async function buildPptx(inputs: Array<PptxSlideInput | string>, options: PptxBuildOptions = {}, signal?: AbortSignal): Promise<Buffer> {
  return (await buildPptxDetailed(inputs, options, signal)).buffer;
}
