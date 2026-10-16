import { NextResponse } from "next/server";
import { createBrandTemplate, listBrandTemplates } from "@/lib/brand-templates";
import { serializeBrandTemplate } from "@/lib/serialize";
import type { BrandTemplate } from "@/lib/types";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ items: listBrandTemplates().map(serializeBrandTemplate) });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const logos = form.getAll("logos").filter((item): item is File => item instanceof File);
    const legacyLogo = form.get("logo");
    if (logos.length === 0 && legacyLogo instanceof File) logos.push(legacyLogo);
    if (logos.length === 0) {
      return NextResponse.json({ error: "请选择 SVG 或透明 PNG Logo" }, { status: 400 });
    }
    const organizationType = String(form.get("organizationType") || "other");
    const template = createBrandTemplate({
      name: String(form.get("name") || ""),
      organizationName: String(form.get("organizationName") || ""),
      organizationType: (["company", "school", "other"].includes(organizationType)
        ? organizationType
        : "other") as BrandTemplate["organizationType"],
      baseStyleId: String(form.get("baseStyleId") || "brand-clean"),
      primaryColor: String(form.get("primaryColor") || "#1664FF"),
      secondaryColor: String(form.get("secondaryColor") || "#0F2C59"),
      logos: await Promise.all(logos.map(async (logo) => ({
        fileName: logo.name,
        bytes: Buffer.from(await logo.arrayBuffer()),
      }))),
    });
    return NextResponse.json(serializeBrandTemplate(template), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "品牌模板创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
