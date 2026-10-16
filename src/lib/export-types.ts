export type PptxExportMode = "editable" | "fidelity";

export interface PptxSlideInput {
  svg: string;
  title?: string;
  notes?: string;
  hidden?: boolean;
}

export interface PptxExportWarning {
  slide: number;
  element: string;
  reason: string;
}

export interface PptxExportResult {
  buffer: Buffer;
  warnings: PptxExportWarning[];
  nativeTextCount: number;
  nativeShapeCount: number;
  nativeImageCount: number;
}

export class PptxExportError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "EXPORT_FAILED", status = 422) {
    super(message);
    this.name = "PptxExportError";
    this.code = code;
    this.status = status;
  }
}

export function parseExportMode(value: string | null | undefined): PptxExportMode {
  if (value == null) return "editable";
  if (value === "editable" || value === "fidelity") return value;
  throw new PptxExportError("导出模式不支持，请选择可编辑 PPTX 或高保真 PPTX", "INVALID_MODE", 400);
}
