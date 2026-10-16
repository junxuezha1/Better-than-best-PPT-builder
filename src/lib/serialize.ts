import { parseAssumptions } from "./store";
import {
  getDeckPlan,
  getLatestStructureProposal,
  getReferenceState,
} from "./project-artifacts";
import { getStylePack, STYLE_PACKS } from "./styles";
import { normalizeSvgForSharpText } from "./svg-sharpness.ts";
import type { EventRow, PageRow, ProjectRow } from "./types";
import type { BrandTemplate } from "./types";
import { brandLogoAssets } from "./brand-templates.ts";
import { getContentMaterialSummary } from "./content-materials.ts";
import { getDesignThemeState } from "./theme-assets.ts";
import { getBackgroundGeneration } from "./background-generation.ts";
import { publicImageSettings } from "./image-settings.ts";

export function serializeProject(project: ProjectRow, pages: PageRow[], events: EventRow[] = []) {
  const assumptions = parseAssumptions(project);
  const researchSources = JSON.parse(project.init_sources_json || "[]") as Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
  const reference = getReferenceState(project.id, project.style_id);
  const brandTemplate = parseBrandTemplate(project.brand_template_json);
  const effectiveReference = reference.status === "pending" && pages.some((page) => page.design_status === "ready")
    ? {
        ...reference,
        status: "confirmed" as const,
        mode: "preset" as const,
        confirmedAt: project.updated_at,
        updatedAt: project.updated_at,
      }
    : reference;
  return {
    id: project.id,
    title: project.title,
    requestText: project.request_text,
    stage: project.stage,
    status: project.status,
    pageCountTarget: project.page_count_target,
    style: getStylePack(project.style_id),
    styles: STYLE_PACKS,
    assumptions,
    requirementsReady: assumptions.questions.length > 0,
    researchSources: researchSources.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
    })),
    outlineReady: Boolean(project.outline_json),
    errorText: project.error_text,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    pages: pages.map(serializePage),
    events: events.map(serializeEvent),
    deckPlan: getDeckPlan(project.id),
    designReference: effectiveReference,
    designTheme: getDesignThemeState(project.id),
    backgroundGeneration: getBackgroundGeneration(project.id),
    imageGenerationConfigured: publicImageSettings().configured,
    brandTemplate: brandTemplate ? serializeBrandTemplate(brandTemplate) : null,
    structureProposal: getLatestStructureProposal(project.id),
    contentMaterials: getContentMaterialSummary(project.id),
    structureChat: events
      .filter((event) => event.kind === "structure-chat-user" || event.kind === "structure-chat-assistant")
      .slice(-20)
      .map((event) => ({
        id: event.id,
        role: event.kind === "structure-chat-user" ? "user" : "assistant",
        text: event.detail || event.title,
        createdAt: event.created_at,
      })),
  };
}

function parseBrandTemplate(value: string): BrandTemplate | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as BrandTemplate;
  } catch {
    return null;
  }
}

export function serializeBrandTemplate(template: BrandTemplate) {
  const assets = brandLogoAssets(template);
  const revision = encodeURIComponent(template.updatedAt || String(template.version));
  return {
    id: template.id,
    version: template.version,
    name: template.name,
    organizationName: template.organizationName,
    organizationType: template.organizationType,
    baseStyleId: template.baseStyleId,
    primaryColor: template.primaryColor,
    secondaryColor: template.secondaryColor,
    logoUrl: `/api/templates/${template.id}/logo?v=${revision}`,
    logoUrls: assets.map(
      (asset) => `/api/templates/${template.id}/logo?asset=${asset.id}&v=${revision}`,
    ),
    assetCount: assets.length,
  };
}

export function serializePage(page: PageRow) {
  return {
    id: page.id,
    pageCode: page.page_code,
    sortOrder: page.sort_order,
    pageType: page.page_type,
    sectionTitle: page.section_title,
    title: page.title,
    bullets: JSON.parse(page.bullets_json || "[]") as string[],
    searchQueries: JSON.parse(page.search_queries_json || "[]") as unknown[],
    sources: JSON.parse(page.sources_json || "[]") as unknown[],
    summaryMd: page.summary_md,
    draftSvg: normalizeSvgForSharpText(page.draft_svg),
    designSvg: normalizeSvgForSharpText(page.design_svg),
    speakerNotes: page.speaker_notes,
    searchStatus: page.search_status,
    summaryStatus: page.summary_status,
    draftStatus: page.draft_status,
    designStatus: page.design_status,
    needsRerun: page.needs_rerun === 1,
  };
}

export function serializeEvent(event: EventRow) {
  return {
    id: event.id,
    pageId: event.page_id,
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    createdAt: event.created_at,
  };
}

export function serializeProjectSummary(project: ProjectRow) {
  return {
    id: project.id,
    title: project.title,
    requestText: project.request_text,
    stage: project.stage,
    status: project.status,
    updatedAt: project.updated_at,
  };
}
