import { normalizeArtifactsIsolated } from "@/lib/artifact-audit";
import { buildPptxDetailed } from "@/lib/export-pptx";
import { createExportHandler } from "@/lib/export-service";
import { auditProjectArtifacts } from "@/lib/pipeline";
import { getProject, listPages } from "@/lib/store";
import { getMaterialPageMetadata } from "@/lib/material-context";

export const runtime = "nodejs";

const handleExport = createExportHandler({ getProject, listPages, pageMetadata: getMaterialPageMetadata, auditProjectArtifacts: (id, signal) => auditProjectArtifacts(id, normalizeArtifactsIsolated, signal), buildPptxDetailed });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleExport(request, id);
}
