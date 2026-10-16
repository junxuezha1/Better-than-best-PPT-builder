import { createHash } from "node:crypto";
import { PptxExportError } from "./export-types.ts";
import { getExportWorkerPool } from "./export-worker-pool.ts";

export interface ArtifactAuditInput { key: string; svg: string }
export interface ArtifactAuditValue { key: string; svg: string | null }
export type ArtifactNormalizer = (inputs: ArtifactAuditInput[], signal?: AbortSignal) => Promise<ArtifactAuditValue[]>;
export const normalizeArtifactsIsolated: ArtifactNormalizer = (inputs, signal) => {
  if (inputs.length > 160 || inputs.reduce((bytes, input) => bytes + Buffer.byteLength(input.svg), 0) > 80 * 1024 * 1024) {
    return Promise.reject(new PptxExportError("待审计设计稿超出资源限制，请减少页面", "SVG_LIMIT"));
  }
  return getExportWorkerPool().run<ArtifactAuditValue[]>({ kind: "audit", inputs }, signal);
};

export function fingerprintArtifactValues(values: unknown): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** Only this synchronous commit boundary may update the main process's store. */
export async function auditArtifactSnapshot<T>(options: {
  inputs: ArtifactAuditInput[];
  fingerprint: string;
  currentFingerprint: () => string;
  alreadyAudited: (fingerprint: string) => boolean;
  normalize: ArtifactNormalizer;
  apply: (values: ArtifactAuditValue[]) => T;
  unchanged: () => T;
  signal?: AbortSignal;
}): Promise<T> {
  const values = await options.normalize(options.inputs, options.signal);
  if (options.signal?.aborted) throw new PptxExportError("导出已取消", "EXPORT_CANCELLED", 499);
  const current = options.currentFingerprint();
  if (current !== options.fingerprint) {
    if (options.alreadyAudited(current)) return options.unchanged();
    throw new PptxExportError("项目内容已变化，请重新导出", "EXPORT_STALE", 409);
  }
  if (values.length !== options.inputs.length || values.some((value, index) => value.key !== options.inputs[index].key)) {
    throw new PptxExportError("稿件审计失败，请重试", "EXPORT_FAILED", 500);
  }
  return options.apply(values);
}
