import { buildPptxDetailed } from "../src/lib/export-pptx-core.ts";
import { extractSvg } from "../src/lib/llm.ts";
import { PptxExportError } from "../src/lib/export-types.ts";
import { parseSvg, serialize, resetRenderBudget } from "../src/lib/svg-pptx-document.ts";
import type { ArtifactAuditInput, ArtifactAuditValue } from "../src/lib/artifact-audit.ts";
import type { PptxSlideInput } from "../src/lib/export-types.ts";
import type { PptxBuildOptions } from "../src/lib/export-pptx.ts";

type Work = { kind: "export"; inputs: Array<PptxSlideInput | string>; options: PptxBuildOptions }
  | { kind: "audit"; inputs: ArtifactAuditInput[] };

process.once("message", async (work: Work) => {
  try {
    resetRenderBudget();
    let value: unknown;
    if (work.kind === "export") value = await buildPptxDetailed(work.inputs, work.options);
    else if (work.kind === "audit") {
      const values: ArtifactAuditValue[] = [];
      for (const item of work.inputs) {
        try {
          // Same historical extraction/quality policy; its parser is isolated too.
          // Validate resource references/signatures before it renders any candidate.
          const normalized = extractSvg(item.svg, candidate => serialize(parseSvg(candidate).documentElement!));
          values.push({ key: item.key, svg: normalized });
        } catch (error) {
          // Resource exhaustion is an operational failure, never a reason to erase ready artifacts.
          if (error instanceof PptxExportError && ["SVG_LIMIT", "RESOURCE_LIMIT"].includes(error.code)) throw error;
          values.push({ key: item.key, svg: null });
        }
      }
      value = values;
    } else throw new PptxExportError("PPTX 导出任务无效", "EXPORT_FAILED", 500);
    process.send?.({ ok: true, value }, () => process.disconnect?.());
  } catch (error) {
    const safe = error instanceof PptxExportError
      ? { code: error.code, message: error.message, status: error.status }
      : { code: "EXPORT_FAILED", message: "PPTX 导出失败", status: 500 };
    process.send?.({ ok: false, error: safe }, () => process.disconnect?.());
  }
});
process.on("disconnect", () => process.exit(0));
