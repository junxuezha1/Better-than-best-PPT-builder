import { NextResponse } from "next/server";
import { brandLogoAssets, getBrandTemplate, readBrandLogo } from "@/lib/brand-templates";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const template = getBrandTemplate(id);
    const assetId = new URL(request.url).searchParams.get("asset") || undefined;
    const asset = brandLogoAssets(template).find((item) => item.id === assetId)
      ?? brandLogoAssets(template)[0];
    return new Response(new Uint8Array(readBrandLogo(template, asset.id)), {
      headers: {
        "Content-Type": asset.mediaType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Logo 不存在";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
