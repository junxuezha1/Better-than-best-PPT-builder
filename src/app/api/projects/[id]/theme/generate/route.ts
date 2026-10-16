import { NextResponse } from "next/server";
import { enqueueBackgroundGeneration } from "@/lib/pipeline";
import { parseBackgroundRequest } from "@/lib/background-generation";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    enqueueBackgroundGeneration(id, parseBackgroundRequest(await request.json()));
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法开始背景生成" }, { status: 400 }); }
}
