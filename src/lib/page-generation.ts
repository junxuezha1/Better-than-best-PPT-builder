import { buildMaterialContext, getContentMaterials, getMaterialImages, getPreparedSlidePlan } from "./content-materials.ts";
import { MATERIAL_EVIDENCE_RULES, PREPARED_COPY_RULES, preparedPageInstructions, getMaterialImageEvidence, materialImageEvidenceContext, embedMaterialImages, getMaterialPageMetadata, materialSlideForPage, preparedSlideEvidence, preparedSlideSources, useMaterialImageReferences, withMaterialImages } from "./material-context.ts";
import { extractSvg, type LlmProgressUpdate } from "./llm";
import { injectBrandLogo } from "./brand-injector.ts";
import { brandContract, parseProjectBrandTemplate } from "./brand-templates.ts";
import { pagePlanFor } from "./deck-plan";
import { generateSvg, isTransientModelError } from "./model-gateway";
import {
  designSvgSystem,
  designUserPrompt,
  draftUserPrompt,
  draftSvgSystem,
} from "./prompts";
import { compactHits, webSearch } from "./search";
import { getDeckPlan, getReferenceState } from "./project-artifacts";
import { requireSearch, requireSvgConfig } from "./settings";
import { getPage, getProject, listPages, updatePage, updateProject } from "./store";
import { getStylePack } from "./styles";
import { getDesignThemeState, resolveThemeBackground } from "./theme-assets.ts";
import { getDesignTheme, themeStyle, themeDesignContract } from "./theme-catalog.ts";
import { composeThemeBackground, stripThemeLayer } from "./theme-composer.ts";
import { withThemeBackground } from "./theme-model-context.ts";
import type { PageRow, SearchHit } from "./types";

export interface PageGenerationRuntime {
  signal: AbortSignal;
  assertActive: () => void;
  isCancelled: () => boolean;
  log: (title: string, detail?: string, kind?: string, pageId?: string) => void;
  searchProgress: (query: string, pageId: string) => (update: LlmProgressUpdate) => void;
  modelRetry: (
    label: string,
    pageId: string,
  ) => (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
}

export function prepareFixedPageEvidence(
  projectId: string,
  page: PageRow,
  runtime: PageGenerationRuntime,
) {
  if (page.project_id !== projectId) throw new Error("页面不属于当前项目");
  const local = pageMaterialEvidence(projectId, page);
  if (local.prepared) {
    savePreparedPageEvidence(page, local.prepared, local.context);
    runtime.log("逐页资料已准备", page.title, "success", page.id);
    return;
  }
  const project = getProject(projectId);
  const sources = compactHits(
    JSON.parse(project.init_sources_json || "[]") as SearchHit[],
    3,
  );
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  updatePage(page.id, {
    search_queries_json: "[]",
    sources_json: JSON.stringify(sources),
    summary_md: [
      `# ${page.title}`,
      page.section_title ? `所属章节：${page.section_title}` : "",
      ...bullets.map((bullet) => `- ${bullet}`),
      sources.length ? `项目级资料：${sources.map((source) => source.title).join("；")}` : "",
      local.context,
    ].filter(Boolean).join("\n"),
    search_status: "ready",
    summary_status: "ready",
  });
  runtime.log("固定页资料已准备", page.title, "success", page.id);
}

export async function researchPage(
  projectId: string,
  pageId: string,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  if (page.project_id !== projectId) throw new Error("页面不属于当前项目");
  const local = pageMaterialEvidence(projectId, page);
  if (local.prepared) {
    runtime.assertActive();
    savePreparedPageEvidence(page, local.prepared, local.context);
    runtime.log("已采用原始逐页证据", "保留上传资料中的引用、限定条件和讲稿", "success", pageId);
    return;
  }
  const search = requireSearch();
  updateProjectStage(projectId, "research");
  updatePage(pageId, { search_status: "running", summary_status: "running" });
  runtime.log(`检索 ${page.title}`, "", "info", pageId);

  const snapshot = listPages(projectId).map((item) => ({
    title: item.title,
    section: item.section_title,
  }));
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  const task = JSON.stringify({
    project: project.request_text,
    page: { title: page.title, section: page.section_title, bullets },
    cross_page_outline: snapshot,
    ...(local.context ? { uploaded_material_evidence: local.context, material_rules: MATERIAL_EVIDENCE_RULES } : {}),
    objective: "一次检索覆盖当前页全部要点，返回可直接支撑页面论证的公开来源",
    instruction: "优先一手来源和权威数据，避免与其它页面重复",
  });
  const found = await webSearch(search, task, {
    onProgress: runtime.searchProgress(page.title, pageId),
    shouldCancel: runtime.isCancelled,
    signal: runtime.signal,
  });
  const unique = dedupeHits(found).slice(0, 5);
  runtime.assertActive();
  updatePage(pageId, {
    search_queries_json: JSON.stringify([{ query: page.title, purpose: "当前页事实与证据" }]),
    sources_json: JSON.stringify(unique),
    summary_md: [local.context, buildEvidenceBrief(page, bullets, unique)].filter(Boolean).join("\n\n"),
    search_status: "ready",
    summary_status: "ready",
  });
  runtime.log("页面资料已就绪", `${unique.length} 条来源`, "success", pageId);
}

export async function draftPage(
  projectId: string,
  pageId: string,
  instruction: string | undefined,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  if (page.project_id !== projectId) throw new Error("页面不属于当前项目");
  const local = pageMaterialEvidence(projectId, page);
  const materialImages = getMaterialImages(projectId, local.prepared?.id ?? page.title, local.prepared ? 12 : 4)
    .map((image) => ({ ...image, optionalUse: !local.prepared }));
  const hasMaterial = Boolean(local.prepared || local.context || materialImages.length);
  const brandTemplate = parseProjectBrandTemplate(project.brand_template_json);
  const plan = getDeckPlan(projectId);
  const pagePlan = pagePlanFor(plan, page, brandTemplate);
  const svg = requireSvgConfig();
  updateProjectStage(projectId, "draft");
  updatePage(pageId, { draft_status: "running" });
  runtime.log(`策划稿 ${page.title}`, "", "info", pageId);
  let draftSvg: string;
  try {
    draftSvg = await generateSvg(
      svg,
      [
        { role: "system", content: draftSvgSystem(page.page_type) + (hasMaterial ? `\n\n${MATERIAL_EVIDENCE_RULES}` : "") + (local.prepared ? `\n\n${PREPARED_COPY_RULES}` : "") },
        {
          role: "user",
          content: withMaterialImages(draftUserPrompt({
            pageType: page.page_type,
            title: page.title,
            sectionTitle: page.section_title,
            bullets: JSON.parse(page.bullets_json || "[]"),
            summary: [page.summary_md, local.context].filter(Boolean).join("\n\n"),
            deckSystem: plan?.shared,
            pagePlan,
            brandContract: brandContract(brandTemplate, pagePlan.brandLogo),
            instruction: preparedPageInstructions({ projectRequest: project.request_text, page, slide: local.prepared, instruction }),
          }), materialImages),
        },
      ],
      {
        maxTokens: 12000,
        temperature: 0.5,
        signal: runtime.signal,
        onRetry: runtime.modelRetry("生成 PPT 初稿", pageId),
        outputTransform: (value) => embedMaterialImages(value, materialImages),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isTransientModelError(message) || runtime.signal.aborted || hasMaterial) throw error;
    draftSvg = buildFallbackDraftSvg(page);
    runtime.log("上游不可用，已生成本地初稿", page.title, "status", pageId);
  }
  runtime.assertActive();
  updatePage(pageId, {
    draft_svg: draftSvg,
    draft_status: "ready",
    design_status: page.design_svg ? "stale" : "empty",
  });
  runtime.log("PPT初稿已就绪", page.title, "success", pageId);
}

function buildFallbackDraftSvg(page: PageRow): string {
  const titleLines = wrapText(page.title, 22, 3);
  const bullets = (JSON.parse(page.bullets_json || "[]") as string[]).slice(0, 4);
  const title = titleLines.map((line, index) =>
    `<tspan x="88" dy="${index === 0 ? 0 : 56}">${escapeXml(line)}</tspan>`
  ).join("");
  const bulletRows = bullets.map((bullet, index) => {
    const lines = wrapText(bullet, 34, 2);
    const y = 330 + index * 82;
    const content = lines.map((line, lineIndex) =>
      `<tspan x="132" dy="${lineIndex === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`
    ).join("");
    return `<circle cx="98" cy="${y - 8}" r="7" fill="#2563eb"/><text x="132" y="${y}" font-family="Arial, sans-serif" font-size="24" fill="#1f2937">${content}</text>`;
  }).join("");
  const section = page.section_title
    ? `<text x="88" y="72" font-family="Arial, sans-serif" font-size="18" fill="#2563eb">${escapeXml(page.section_title)}</text>`
    : "";
  return extractSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
    <rect width="1280" height="720" fill="#f8fafc"/>
    <rect x="0" y="0" width="18" height="720" fill="#2563eb"/>
    ${section}
    <text x="88" y="145" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#0f172a">${title}</text>
    <line x1="88" y1="286" x2="1192" y2="286" stroke="#cbd5e1" stroke-width="2"/>
    ${bulletRows || `<text x="88" y="360" font-family="Arial, sans-serif" font-size="26" fill="#334155">${escapeXml(page.title)}</text>`}
    <text x="1192" y="668" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#64748b">${escapeXml(page.page_code)}</text>
  </svg>`);
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const compact = value.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  for (let offset = 0; offset < compact.length && lines.length < maxLines; offset += maxChars) {
    const chunk = compact.slice(offset, offset + maxChars);
    const hasMore = offset + maxChars < compact.length;
    lines.push(hasMore && lines.length === maxLines - 1 ? `${chunk.slice(0, -1)}…` : chunk);
  }
  return lines.length ? lines : ["内容页"];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function designPage(
  projectId: string,
  pageId: string,
  instruction: string | undefined,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const brandTemplate = parseProjectBrandTemplate(project.brand_template_json);
  const page = getPage(pageId);
  if (page.project_id !== projectId) throw new Error("页面不属于当前项目");
  const local = pageMaterialEvidence(projectId, page);
  const materialImages = getMaterialImages(projectId, local.prepared?.id ?? page.title, local.prepared ? 12 : 4)
    .map((image) => ({ ...image, optionalUse: !local.prepared }));
  const hasMaterial = Boolean(local.prepared || local.context || materialImages.length);
  if (!page.draft_svg) throw new Error("没有策划稿，不能出设计稿");
  const svg = requireSvgConfig();
  const selection = getDesignThemeState(projectId).selection;
  const background = selection ? resolveThemeBackground(projectId, selection, page.page_type) : undefined;
  const style = selection ? themeStyle(getDesignTheme(selection.themeId, selection.definition), getStylePack(project.style_id)) : getStylePack(project.style_id);
  const themeContract = selection ? themeDesignContract(selection, page.page_type) : "";
  const plan = getDeckPlan(projectId);
  const reference = getReferenceState(projectId, project.style_id);
  const legacyDesign = listPages(projectId).some((item) => item.design_status === "ready");
  if (reference.status !== "confirmed" && !legacyDesign) {
    throw new Error("请先确认设计参考，再生成设计稿");
  }
  const pagePlan = pagePlanFor(plan, page, brandTemplate);
  updateProjectStage(projectId, "design");
  updatePage(pageId, { design_status: "running" });
  runtime.log(`设计稿 ${page.title}`, style.name, "info", pageId);
  let designSvg: string;
  try {
    designSvg = await generateSvg(
      svg,
      [
        {
          role: "system",
          content: designSvgSystem(style, page.page_type, reference.profile) + (hasMaterial ? `\n\n${MATERIAL_EVIDENCE_RULES}` : "") + (local.prepared ? `\n\n${PREPARED_COPY_RULES}` : "") + themeContract,
        },
        {
          role: "user",
          content: withThemeBackground(withMaterialImages(designUserPrompt({
            draftSvg: useMaterialImageReferences(stripThemeLayer(page.draft_svg), materialImages),
            pageType: page.page_type,
            title: page.title,
            sectionTitle: page.section_title,
            deckSystem: plan?.shared,
            pagePlan,
            reference: reference.profile,
            colorPreference: reference.colorPreference,
            brandContract: brandContract(brandTemplate, pagePlan.brandLogo),
            instruction: preparedPageInstructions({ projectRequest: project.request_text, page, slide: local.prepared, instruction }),
          }) + (hasMaterial ? `\n\n原始内容证据与引用（保持其含义）：\n${page.summary_md}\n${local.context}` : "") + themeContract, materialImages), background?.toString("base64")),
        },
      ],
      {
        maxTokens: 12000,
        temperature: 0.4,
        signal: runtime.signal,
        onRetry: runtime.modelRetry("生成视觉设计", pageId),
        outputTransform: (value) => composeThemeBackground(extractSvg(embedMaterialImages(value, materialImages)), selection, background),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isTransientModelError(message) || runtime.signal.aborted || selection) throw error;
    designSvg = extractSvg(page.draft_svg);
    runtime.log("上游不可用，已沿用校验通过的初稿", page.title, "status", pageId);
  }
  runtime.assertActive();
  const brandedSvg = injectBrandLogo(designSvg, brandTemplate, page.page_type, pagePlan.brandLogo);
  updatePage(pageId, { design_svg: brandedSvg, design_status: "ready" });
  runtime.log("设计稿已就绪", page.title, "success", pageId);
}

function pageMaterialEvidence(projectId: string, page: PageRow) {
  const prepared = materialSlideForPage(getPreparedSlidePlan(projectId), getMaterialPageMetadata(projectId, page.id));
  const context = [
    buildMaterialContext(projectId, prepared?.title ?? `${page.title} ${page.section_title || ""}`, prepared ? 6000 : 14000),
    prepared ? "" : materialImageEvidenceContext(getMaterialImageEvidence(projectId, getContentMaterials(projectId)?.uploadId)),
  ].filter(Boolean).join("\n\n");
  return { prepared, context };
}

function savePreparedPageEvidence(page: PageRow, slide: NonNullable<ReturnType<typeof materialSlideForPage>>, context: string) {
  updatePage(page.id, {
    search_queries_json: "[]",
    sources_json: JSON.stringify(preparedSlideSources(slide)),
    summary_md: [preparedSlideEvidence(slide, page), context].filter(Boolean).join("\n\n"),
    search_status: "ready",
    summary_status: "ready",
  });
}

function updateProjectStage(projectId: string, stage: "research" | "draft" | "design") {
  const project = getProject(projectId);
  if (project.stage !== stage || project.status !== "running") {
    updateProject(projectId, { stage, status: "running" });
  }
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = hit.url || hit.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceBrief(page: PageRow, bullets: string[], hits: SearchHit[]): string {
  const evidence = hits.map((hit, index) => {
    const excerpt = (hit.content || hit.snippet).replace(/\s+/g, " ").trim().slice(0, 900);
    return [`## 来源 ${index + 1}｜${hit.title}`, `URL：${hit.url}`, excerpt].join("\n");
  });
  return [
    `# 页面证据简报｜${page.title}`,
    `页面目标：${bullets.join("；") || page.title}`,
    ...evidence,
    hits.length ? "" : "未检索到可靠公开来源。仅使用页面提纲，不补造事实。",
  ].filter(Boolean).join("\n\n");
}
