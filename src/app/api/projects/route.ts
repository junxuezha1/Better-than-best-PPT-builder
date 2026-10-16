import { NextResponse } from "next/server";
import { enqueuePipeline } from "@/lib/pipeline";
import { serializeProjectSummary } from "@/lib/serialize";
import { getSettings, isAppConfigured } from "@/lib/settings";
import { createProject, listProjects, updateProject } from "@/lib/store";
import { getBrandTemplate } from "@/lib/brand-templates";
import { saveReferenceState } from "@/lib/project-artifacts";
import { parseMaterialProjectRequest } from "@/lib/material-request";
import { prepareContentMaterials, saveContentMaterials } from "@/lib/content-materials";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    items: listProjects().map(serializeProjectSummary),
  });
}

export async function POST(request: Request) {
  try {
    const body = await parseMaterialProjectRequest(request);
    const requestText = body.requestText;
    const settings = getSettings();
    if (!isAppConfigured(settings)) {
      return NextResponse.json({ error: "先在设置里配好文本、SVG 和搜索模型" }, { status: 400 });
    }
    const brandTemplate = body.brandTemplateId ? getBrandTemplate(body.brandTemplateId) : null;
    // Fully validate and parse the batch before a project or model job exists.
    const materials = body.files.length ? await prepareContentMaterials(body.files, {
      signal: request.signal,
      usePreparedPlan: body.usePreparedPlan,
    }) : null;
    if (request.signal.aborted) throw new Error("上传已取消");
    const project = createProject(requestText, brandTemplate);
    if (materials) {
      try { saveContentMaterials(project.id, materials); }
      catch {
        updateProject(project.id, { status: "failed", error_text: "内容资料保存失败，请重新上传" });
        throw new Error("内容资料保存失败，尚未开始生成，请重新上传");
      }
    }
    if (brandTemplate) {
      saveReferenceState(project.id, {
        status: "confirmed",
        mode: "brand",
        styleId: brandTemplate.baseStyleId,
        colorPreference: `严格使用 ${brandTemplate.primaryColor} 与 ${brandTemplate.secondaryColor} 作为品牌主色`,
        uploadId: "",
        fileName: "",
        fileType: "",
        pageCount: 0,
        profile: brandTemplate.profile,
        error: "",
        updatedAt: "",
        confirmedAt: new Date().toISOString(),
      });
    }
    enqueuePipeline(project.id);
    return NextResponse.json({ id: project.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
