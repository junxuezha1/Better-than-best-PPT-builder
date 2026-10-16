import { buildMaterialContext, getContentMaterials, getPreparedSlidePlan } from "./content-materials.ts";
import { MATERIAL_EVIDENCE_RULES, PREPARED_COPY_RULES, getMaterialImageEvidence, materialImageEvidenceContext, getMaterialPageMetadata, materialSlideForPage, preparedFallbackPagePlan, preparedFallbackVisualSystem, type PreparedMaterialSlideInput } from "./material-context.ts";
import crypto from "node:crypto";
import { generateJson, isRecoverableModelOutputError } from "./model-gateway";
import { DECK_PLAN_SYSTEM } from "./prompts";
import { getDeckPlan, saveDeckPlan } from "./project-artifacts";
import { requireTextConfig } from "./settings";
import { getProject, listPages, updateProject } from "./store";
import { brandContract, parseProjectBrandTemplate } from "./brand-templates.ts";
import { resolveBrandLogoPlan, stripLegacyLogoReservations } from "./brand-logo-layout.ts";
import type {
  BrandTemplate,
  DeckPagePlan,
  DeckPlan,
  DeckVisualSystem,
  PageRow,
  PageType,
  VisualSlotKind,
} from "./types";

interface DeckPlanRuntime {
  signal: AbortSignal;
  assertActive: () => void;
  log: (title: string, detail?: string, kind?: string) => void;
  onRetry: (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
}

interface RawDeckPage {
  page_code?: string;
  page_type?: string;
  title?: string;
  objective?: string;
  layout?: string;
  hierarchy?: string[];
  reading_order?: string[];
  visual_slots?: Array<{
    kind?: string;
    purpose?: string;
    placement?: string;
    aspect_ratio?: string;
    query?: string;
    fallback?: string;
  }>;
  brand_logo?: { slot?: string };
}

interface PreparedPlanningContext {
  shared: DeckVisualSystem;
  slides: Map<string, PreparedMaterialSlideInput>;
}

interface RawDeckPlan {
  shared?: Partial<DeckVisualSystem> & {
    title_system?: string;
    card_system?: string;
    graphic_language?: string;
    consistency_rules?: string[];
  };
  pages?: RawDeckPage[];
}

export function deckOutlineFingerprint(pages: PageRow[]): string {
  const payload = pages.map((page) => ({
    code: page.page_code,
    type: page.page_type,
    section: page.section_title,
    title: page.title,
    bullets: page.bullets_json,
    summary: page.summary_md.slice(0, 1800),
  }));
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export async function ensureDeckPlan(
  projectId: string,
  runtime: DeckPlanRuntime,
): Promise<DeckPlan> {
  const pages = listPages(projectId);
  const fingerprint = deckOutlineFingerprint(pages);
  const current = getDeckPlan(projectId);
  if (current?.status === "ready" && current.outlineFingerprint === fingerprint) {
    return current;
  }

  const project = getProject(projectId);
  const brandTemplate = parseProjectBrandTemplate(project.brand_template_json);
  const materialEvidence = [buildMaterialContext(projectId, "视觉规范 visual-design-contract", 8000), materialImageEvidenceContext(getMaterialImageEvidence(projectId, getContentMaterials(projectId)?.uploadId))].filter(Boolean).join("\n\n");
  const preparedPlan = getPreparedSlidePlan(projectId);
  const prepared: PreparedPlanningContext | undefined = preparedPlan
    ? { shared: preparedFallbackVisualSystem(project.request_text, materialEvidence), slides: new Map() }
    : undefined;
  if (prepared && preparedPlan) {
    for (const page of pages) {
      const slide = materialSlideForPage(preparedPlan, getMaterialPageMetadata(projectId, page.id));
      if (slide) prepared.slides.set(page.id, slide);
    }
  }
  updateProject(projectId, { stage: "planning", status: "running" });
  runtime.log("正在统一整套内容策划", `${pages.length} 页共用一份 Deck Plan`, "info");
  let payload: RawDeckPlan;
  try {
    payload = await generateJson<RawDeckPlan>(requireTextConfig(), [
      { role: "system", content: DECK_PLAN_SYSTEM + (materialEvidence ? `\n\n${MATERIAL_EVIDENCE_RULES}` : "") + (prepared ? `\n\n${PREPARED_COPY_RULES}` : "") },
      {
        role: "user",
        content: JSON.stringify({
          topic: project.request_text,
          ...(materialEvidence ? { uploaded_material_evidence: materialEvidence } : {}),
          brand_template: brandContract(brandTemplate),
          existing_shared_system: current?.shared ?? null,
          instruction: current?.shared
            ? "严格保留 existing_shared_system，只更新逐页计划以适配当前结构"
            : "建立一套清爽、统一、适合评审的策划稿视觉合同",
          pages: pages.map((page) => ({
            page_code: page.page_code,
            page_type: page.page_type,
            section_title: page.section_title,
            title: page.title,
            outline_points: JSON.parse(page.bullets_json || "[]"),
            evidence_brief: page.summary_md.slice(0, prepared ? 900 : materialEvidence ? 3000 : 1800),
            ...(materialEvidence ? { uploaded_page_metadata: getMaterialPageMetadata(projectId, page.id) } : {}),
            ...(prepared?.slides.has(page.id) ? {
              confirmed_copy_only: true,
              page_purpose_not_for_display: prepared.slides.get(page.id)?.goal,
              original_design_notes: prepared.slides.get(page.id)?.designNotes,
              original_asset_instructions: prepared.slides.get(page.id)?.assetInstructions,
            } : {}),
          })),
        }),
      },
    ], {
      maxTokens: materialEvidence ? Math.max(4096, Math.min(16000, pages.length * 320)) : 4096,
      temperature: 0.2,
      signal: runtime.signal,
      onRetry: runtime.onRetry,
    });
  } catch (error) {
    if (!isRecoverableModelOutputError(error)) throw error;
    runtime.log(
      "整套内容策划已降级恢复",
      prepared
        ? "上游模型超时或返回了无效 JSON，已保留项目视觉要求、信息密度和逐页设计说明，继续生成"
        : "上游模型超时或返回了无效 JSON，已使用统一默认视觉合同继续生成",
      "status",
    );
    payload = {};
  }
  runtime.assertActive();
  const plan = normalizeDeckPlan(payload, pages, current?.shared, fingerprint, brandTemplate, prepared);
  saveDeckPlan(projectId, plan);
  runtime.log("整套内容策划已就绪", "版式、字阶与配图意图已统一", "success");
  return plan;
}

export function pagePlanFor(
  plan: DeckPlan | null,
  page: PageRow,
  brandTemplate: BrandTemplate | null = null,
): DeckPagePlan {
  const stored = plan?.pages.find((item) => item.pageCode === page.page_code);
  if (!stored) {
    const preparedSlide = materialSlideForPage(getPreparedSlidePlan(page.project_id), getMaterialPageMetadata(page.project_id, page.id));
    return fallbackPagePlan(page, brandTemplate, preparedSlide ?? undefined);
  }
  const layout = stripLegacyLogoReservations(stored.layout);
  return {
    ...stored,
    layout,
    brandLogo: resolveBrandLogoPlan({
      requestedSlot: stored.brandLogo?.slot,
      template: brandTemplate,
      layout,
      visualSlots: stored.visualSlots,
    }),
  };
}

function normalizeDeckPlan(
  raw: RawDeckPlan,
  pages: PageRow[],
  preservedShared: DeckVisualSystem | undefined,
  fingerprint: string,
  brandTemplate: BrandTemplate | null,
  prepared?: PreparedPlanningContext,
): DeckPlan {
  const shared = preservedShared ?? normalizeShared(raw.shared, prepared?.shared);
  const byCode = new Map((raw.pages ?? []).map((page) => [page.page_code, page]));
  return {
    version: 1,
    status: "ready",
    generatedAt: new Date().toISOString(),
    outlineFingerprint: fingerprint,
    shared,
    pages: pages.map((page) => normalizePagePlan(page, byCode.get(page.page_code), brandTemplate, prepared?.slides.get(page.id))),
  };
}

function normalizeShared(raw: RawDeckPlan["shared"], fallback?: DeckVisualSystem): DeckVisualSystem {
  return {
    concept: clean(raw?.concept) || fallback?.concept || "编辑式信息工坊：清爽、克制、结论先行",
    canvas: clean(raw?.canvas) || fallback?.canvas || "1280×720 浅暖灰画布，统一使用纯色背景",
    grid: clean(raw?.grid) || fallback?.grid || "12 栏网格，内容区按 20px 间距组合",
    margins: clean(raw?.margins) || fallback?.margins || "四周 52px 安全边距，标题区与内容区间隔 24px",
    titleSystem: clean(raw?.titleSystem ?? raw?.title_system)
      || fallback?.titleSystem || "标题固定在左上，主标题 30–36px，章节眉题 14px",
    typography: clean(raw?.typography)
      || fallback?.typography || "中文无衬线；标题 30–36px，卡片标题 20–24px，正文 16–20px，辅助文字 13–15px",
    palette: normalizePalette(raw?.palette, fallback?.palette),
    cardSystem: clean(raw?.cardSystem ?? raw?.card_system)
      || fallback?.cardSystem || "12–16px 圆角、1px 冷灰描边、无重阴影；卡片间距至少 20px",
    graphicLanguage: clean(raw?.graphicLanguage ?? raw?.graphic_language)
      || fallback?.graphicLanguage || "线性图标、扁平信息图、清晰节点连线；不用装饰性 HUD",
    consistencyRules: cleanList(raw?.consistencyRules ?? raw?.consistency_rules).length
      ? cleanList(raw?.consistencyRules ?? raw?.consistency_rules)
      : fallback?.consistencyRules ?? ["标题锚点跨页一致", "卡片半径与间距一致", "强调色每页只承担一种语义"],
  };
}

function normalizePagePlan(page: PageRow, raw: RawDeckPage | undefined, brandTemplate: BrandTemplate | null, preparedSlide?: PreparedMaterialSlideInput): DeckPagePlan {
  if (!raw) return fallbackPagePlan(page, brandTemplate, preparedSlide);
  const slots = (raw.visual_slots ?? []).slice(0, 3).map((slot) => ({
    kind: normalizeVisualKind(slot.kind),
    purpose: clean(slot.purpose),
    placement: clean(slot.placement),
    aspectRatio: clean(slot.aspect_ratio) || "16:10",
    query: clean(slot.query),
    fallback: clean(slot.fallback) || "用原生 SVG 信息图完成同一信息任务",
  })).filter((slot) => slot.kind !== "none" || slot.purpose);
  const fallback = fallbackPagePlan(page, brandTemplate, preparedSlide);
  const layout = stripLegacyLogoReservations(clean(raw.layout) || fallback.layout);
  return {
    pageCode: page.page_code,
    pageType: page.page_type,
    title: page.title,
    objective: clean(raw.objective) || fallback.objective,
    layout,
    hierarchy: cleanList(raw.hierarchy).length ? cleanList(raw.hierarchy) : fallback.hierarchy,
    readingOrder: cleanList(raw.reading_order).length ? cleanList(raw.reading_order) : fallback.readingOrder,
    visualSlots: slots.length ? slots : fallback.visualSlots,
    brandLogo: resolveBrandLogoPlan({
      requestedSlot: raw.brand_logo?.slot,
      template: brandTemplate,
      layout,
      visualSlots: slots.length ? slots : fallback.visualSlots,
    }),
  };
}

function fallbackPagePlan(page: PageRow, brandTemplate: BrandTemplate | null = null, preparedSlide?: PreparedMaterialSlideInput): DeckPagePlan {
  if (preparedSlide) {
    const fallback = preparedFallbackPagePlan(page, preparedSlide);
    return { ...fallback, brandLogo: resolveBrandLogoPlan({ template: brandTemplate, layout: fallback.layout, visualSlots: fallback.visualSlots }) };
  }
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  const kind = inferVisualKind(page.page_type, `${page.title} ${bullets.join(" ")}`);
  const layouts: Record<PageType, string> = {
    cover: "单一焦点：左侧标题与右侧概念主视觉",
    toc: "编号故事线：章节标题形成清晰阅读路径",
    section: "大留白章节换场：超大标题与单一概念图形",
    content: kind === "photo"
      ? "非对称两栏：信息卡 2/3，实拍图位 1/3"
      : "主次结合：主结论卡与辅助信息图",
    end: "单一焦点：核心结论居中收束",
  };
  const visualSlots: DeckPagePlan["visualSlots"] = page.page_type === "content"
    ? [{
        kind,
        purpose: kind === "photo" ? "建立真实场景与对象认知" : "把核心关系从文字转成可扫读视觉",
        placement: "主内容区的视觉焦点卡",
        aspectRatio: "16:10",
        query: kind === "photo" ? `${page.title} 真实场景 专业摄影` : "",
        fallback: "使用原生 SVG 关系图或主题插画完成表达",
      }]
    : [{
        kind: "svg_illustration",
        purpose: "建立页型识别与叙事节奏",
        placement: "标题相对侧",
        aspectRatio: "1:1",
        query: "",
        fallback: "使用原生 SVG 概念图形",
      }];
  return {
    pageCode: page.page_code,
    pageType: page.page_type,
    title: page.title,
    objective: bullets[0] || page.title,
    layout: layouts[page.page_type],
    hierarchy: [page.title, ...bullets.slice(0, 3)],
    readingOrder: ["页面结论", "核心证据", "视觉解释"],
    visualSlots,
    brandLogo: resolveBrandLogoPlan({ template: brandTemplate, layout: layouts[page.page_type], visualSlots }),
  };
}

function inferVisualKind(pageType: PageType, text: string): VisualSlotKind {
  if (pageType !== "content") return "svg_illustration";
  if (/趋势|增长|比例|数据|预算|成本|对比|排名/.test(text)) return "chart";
  if (/流程|路径|步骤|体系|关系|架构|闭环|机制/.test(text)) return "diagram";
  if (/地点|建筑|产品|人物|空间|旅游|酒店|工厂|门店|案例/.test(text)) return "photo";
  return "svg_illustration";
}

function normalizeVisualKind(value: string | undefined): VisualSlotKind {
  return ["diagram", "chart", "svg_illustration", "photo", "none"].includes(value || "")
    ? value as VisualSlotKind
    : "svg_illustration";
}

function normalizePalette(value: unknown, fallback?: string[]): string[] {
  const colors = Array.isArray(value)
    ? value.map((item) => clean(item)).filter((item) => /^#[0-9a-f]{6}$/i.test(item)).slice(0, 6)
    : [];
  return colors.length >= 3 ? colors : fallback ?? ["#F7F8FA", "#17243A", "#2F80FF", "#DCE5F2"];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 600) : "";
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 12) : [];
}
