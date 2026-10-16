import { NextResponse } from "next/server";
import { getProject, listPages } from "@/lib/store";
import { saveThemeUpload, getDesignThemeState, resolveThemeBackground, readGeneratedTheme } from "@/lib/theme-assets";
import { parseThemeSelection } from "@/lib/theme-catalog";
import { composeThemeBackground, themeSampleSvg } from "@/lib/theme-composer";
import { extractSvg } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    getProject(id);
    if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) throw new Error("背景图片最大 10MB");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024) throw new Error("请选择不超过 10MB 的 PNG、JPEG 或 WebP 背景");
    const asset = await saveThemeUpload(id, file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ asset, designTheme: getDesignThemeState(id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "背景上传失败" }, { status: 400 }); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const project = getProject(id);
    const query = new URL(request.url).searchParams;
    const selection = parseThemeSelection({ themeId: query.get("themeId"), definition: readGeneratedTheme(id, query.get("themeId") || ""), intensity: Number(query.get("intensity") ?? "1"), coverAssetId: query.get("coverAssetId") || "", bodyAssetId: query.get("bodyAssetId") || "" });
    if (!selection) throw new Error("请选择主题");
    const cover = query.get("role") === "cover";
    const pages = listPages(id);
    const page = query.has("pageId") ? pages.find((item) => item.id === query.get("pageId"))
      : pages.find((item) => item.page_type === (cover ? "cover" : "content"));
    if (query.has("pageId") && !page) throw new Error("页面不属于此项目");
    const exact = query.get("exact") === "true";
    if (exact && !page?.design_svg) throw new Error("此页还没有设计稿");
    const background = resolveThemeBackground(id, selection, exact ? page!.page_type : cover ? "cover" : "content");
    const svg = exact
      ? composeThemeBackground(extractSvg(page!.design_svg), selection, background)
      : themeSampleSvg({ title: page?.title || project.title, bullets: page ? JSON.parse(page.bullets_json || "[]") : [], cover, selection, background });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "预览失败" }, { status: 400 }); }
}
