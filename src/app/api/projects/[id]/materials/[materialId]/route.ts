import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { readMaterialFile } from "@/lib/content-materials";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; materialId: string }> }) {
  try {
    const { id, materialId } = await context.params;
    getProject(id);
    const file = readMaterialFile(id, materialId);
    const inline = /^image\/(?:png|jpeg|webp)$/.test(file.mimeType);
    return new Response(new Uint8Array(file.bytes), { headers: {
      "Content-Type": inline ? file.mimeType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, "%27")}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    } });
  } catch {
    return NextResponse.json({ error: "项目资料不存在或无法读取" }, { status: 404 });
  }
}
