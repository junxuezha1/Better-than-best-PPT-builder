import { NextResponse } from "next/server";
import { refreshBrandTemplateProjects } from "@/lib/brand-refresh";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(refreshBrandTemplateProjects(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "品牌层刷新失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
