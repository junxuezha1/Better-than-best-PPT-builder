import type { PptxExportMode } from "../../lib/export-types.ts";

const PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface PptxDownload {
  blob: Blob;
  fileName: string;
  fallbackCount: number;
  fallbackSlides: number[];
}

/** Validate the response before the browser treats it as a presentation download. */
export async function requestPptxDownload(
  projectId: string,
  mode: PptxExportMode,
  signal?: AbortSignal,
): Promise<PptxDownload> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/export?mode=${mode}`,
    { signal },
  );
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "error" in data
      && typeof data.error === "string" ? data.error.trim() : "";
    throw new Error(message || `导出失败（${response.status}），请稍后重试`);
  }
  const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== PPTX_MEDIA_TYPE) {
    throw new Error("导出响应不是 PPTX 文件，请重试或选择高保真 PPTX");
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("导出文件为空，请重试");

  const fallbackCount = positiveInteger(response.headers.get("X-PPTX-Fallback-Count"));
  const fallbackSlides = [...new Set(
    (response.headers.get("X-PPTX-Fallback-Slides") || "")
      .split(",").map(positiveInteger).filter((value) => value > 0),
  )].sort((left, right) => left - right);

  return {
    blob,
    fileName: downloadFileName(response.headers.get("Content-Disposition"), mode),
    fallbackCount,
    fallbackSlides,
  };
}

function positiveInteger(value: string | null): number {
  if (!value || !/^\d+$/.test(value.trim())) return 0;
  const number = Number(value.trim());
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function downloadFileName(disposition: string | null, mode: PptxExportMode): string {
  const extended = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1];
  const plain = disposition?.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  let value = plain?.[1] || plain?.[2] || "";
  if (extended) {
    try { value = decodeURIComponent(extended.trim()); } catch { /* Use the ASCII fallback. */ }
  }
  const safe = value.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\.pptx$/i, "")
    .slice(0, 160);
  return `${safe || (mode === "editable" ? "演示文稿-可编辑" : "演示文稿-高保真")}.pptx`;
}

export function pptxDownloadMessage(download: PptxDownload, mode: PptxExportMode): string {
  const label = mode === "editable" ? "可编辑 PPTX" : "高保真 PPTX";
  if (!download.fallbackCount) return `${label} 已下载`;
  const pages = download.fallbackSlides.length
    ? `第 ${download.fallbackSlides.join("、")} 页有 ` : "";
  return `${label} 已下载。${pages}${download.fallbackCount} 处复杂内容已转为图片。`;
}
