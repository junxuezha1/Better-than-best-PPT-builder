import { exportFailure } from "@/lib/export-service";
import { PptxExportError } from "@/lib/export-types";
import { normalizeArtifactsIsolated } from "@/lib/artifact-audit";
import { NextResponse } from "next/server";
import { auditProjectArtifacts, enqueuePipeline, isRunning } from "@/lib/pipeline";
import { serializeProject } from "@/lib/serialize";
import { getProject, listEvents, listPages } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await auditProjectArtifacts(id, normalizeArtifactsIsolated, _request.signal);
    const project = getProject(id);
    if (project.status === "running" && !isRunning(id)) {
      enqueuePipeline(id);
    }
    return NextResponse.json(
      serializeProject(project, listPages(id), listEvents(id)),
    );
  } catch (error) {
    if (error instanceof PptxExportError) return exportFailure(error);
    const message = error instanceof Error ? error.message : "读取失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
