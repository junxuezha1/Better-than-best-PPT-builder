import { NextResponse } from "next/server";
import { getImageSettings, publicImageSettings, saveImageSettings } from "@/lib/image-settings";
import { parseImageConfig } from "@/lib/image-config";
import { listImageModels, validateImageModel } from "@/lib/gotocc-images";
export const runtime = "nodejs";
export function GET() { return NextResponse.json({ config: publicImageSettings() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : getImageSettings().apiKey;
    if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("请填写有效的 GotoCC 图片 Key");
    return NextResponse.json({ models: await listImageModels({ apiKey }, request.signal) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "模型验证失败" }, { status: 400 }); }
}
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const config = parseImageConfig(body, getImageSettings().apiKey);
    await validateImageModel(config, request.signal);
    return NextResponse.json({ config: saveImageSettings(config) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "图片配置保存失败" }, { status: 400 }); }
}
