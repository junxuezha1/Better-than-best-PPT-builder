import { NextResponse } from "next/server";
import { serializeProjectSummary } from "@/lib/serialize";
import { isAppConfigured } from "@/lib/settings";
import { listProjects } from "@/lib/store";
import { listBrandTemplates } from "@/lib/brand-templates";
import { serializeBrandTemplate } from "@/lib/serialize";
import { STYLE_PACKS } from "@/lib/styles";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    projects: listProjects().map(serializeProjectSummary),
    configured: isAppConfigured(),
    brandTemplates: listBrandTemplates().map(serializeBrandTemplate),
    styles: STYLE_PACKS,
  });
}
