import fs from "node:fs";
import path from "node:path";
import { newId } from "./db.ts";
import { BRAND_LOGO_SLOTS, brandLogoSlot, brandLogoSlotContract } from "./brand-logo-layout.ts";
import { getStylePack } from "./styles.ts";
import type { BrandLogoAsset, BrandLogoPlan, BrandTemplate, PageType, ReferenceStyleProfile } from "./types.ts";

const templatesRoot = path.join(process.cwd(), "data", "templates");
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

const DEFAULT_PLACEMENTS: BrandTemplate["placements"] = {
  cover: { x: 1030, y: 42, width: 186, height: 50, plate: true },
  toc: { x: 1070, y: 42, width: 146, height: 38, plate: true },
  section: { x: 1050, y: 42, width: 166, height: 42, plate: true },
  content: { x: 1080, y: 42, width: 136, height: 34, plate: true },
  end: { x: 552, y: 638, width: 176, height: 42, plate: true },
};

export function listBrandTemplates(): BrandTemplate[] {
  try {
    return fs.readdirSync(templatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readTemplateFile(path.join(templatesRoot, entry.name, "template.json")))
      .filter((item): item is BrandTemplate => Boolean(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function getBrandTemplate(id: string): BrandTemplate {
  const safeId = safeSegment(id);
  const template = readTemplateFile(path.join(templatesRoot, safeId, "template.json"));
  if (!template) throw new Error("品牌模板不存在");
  return template;
}

export function parseProjectBrandTemplate(value: string): BrandTemplate | null {
  if (!value) return null;
  try {
    return normalizeLoadedTemplate(JSON.parse(value) as BrandTemplate);
  } catch {
    return null;
  }
}

export function createBrandTemplate(input: {
  name: string;
  organizationName: string;
  organizationType: BrandTemplate["organizationType"];
  baseStyleId: string;
  primaryColor: string;
  secondaryColor: string;
  logos: Array<{ fileName: string; bytes: Buffer }>;
}): BrandTemplate {
  const name = clean(input.name, 60);
  const organizationName = clean(input.organizationName, 100);
  if (!name || !organizationName) throw new Error("请填写模板名称和组织名称");
  const primaryColor = normalizeColor(input.primaryColor, "#1664FF");
  const secondaryColor = normalizeColor(input.secondaryColor, "#0F2C59");
  const style = getStylePack(input.baseStyleId);
  if (input.logos.length === 0 || input.logos.length > 3) {
    throw new Error("请选择 1 到 3 个 Logo 变体");
  }
  const logos = input.logos.map((item, index) => {
    const logo = validateBrandLogo(item.fileName, item.bytes, index);
    return {
      id: `logo-${index + 1}`,
      file: logo.fileName,
      mediaType: logo.mediaType,
      orientation: logo.orientation,
      originalName: path.basename(item.fileName),
      bytes: logo.bytes,
    } satisfies BrandLogoAsset & { bytes: Buffer };
  });
  const placements = placementsForAssets(logos);
  const logo = logos[0];
  const id = newId("tpl");
  const stamp = new Date().toISOString();
  const template: BrandTemplate = {
    id,
    version: 1,
    name,
    organizationName,
    organizationType: input.organizationType,
    baseStyleId: style.id,
    primaryColor,
    secondaryColor,
    logoFile: logo.file,
    logoMediaType: logo.mediaType,
    logoAssets: logos.map(({ bytes: _bytes, ...asset }) => asset),
    placements,
    profile: buildBrandProfile(name, organizationName, primaryColor, secondaryColor, style, placements),
    createdAt: stamp,
    updatedAt: stamp,
  };
  const target = path.join(templatesRoot, id);
  fs.mkdirSync(target, { recursive: true });
  for (const asset of logos) {
    fs.writeFileSync(path.join(target, asset.file), asset.bytes, { flag: "wx" });
  }
  writeJson(path.join(target, "template.json"), template);
  return template;
}

export function brandLogoAssets(template: BrandTemplate): BrandLogoAsset[] {
  return template.logoAssets?.length
    ? template.logoAssets
    : [{
        id: "logo-1",
        file: template.logoFile,
        mediaType: template.logoMediaType,
        orientation: "wide",
        originalName: template.logoFile,
      }];
}

export function brandLogoAssetForPage(template: BrandTemplate, pageType?: PageType): BrandLogoAsset {
  const assets = brandLogoAssets(template);
  const requested = pageType ? template.pageLogoAssets?.[pageType] : undefined;
  return assets.find((asset) => asset.id === requested) ?? assets[0];
}

export function readBrandLogo(template: BrandTemplate, assetId?: string): Buffer {
  const assets = brandLogoAssets(template);
  const asset = assets.find((item) => item.id === assetId) ?? assets[0];
  return fs.readFileSync(path.join(templatesRoot, safeSegment(template.id), asset.file));
}

export function brandContract(
  template: BrandTemplate | null,
  plan?: BrandLogoPlan,
): Record<string, unknown> | null {
  if (!template) return null;
  const chosen = plan ? brandLogoSlot(plan.slot) : null;
  return {
    template: template.name,
    organization: template.organizationName,
    colors: [template.primaryColor, template.secondaryColor],
    typography: template.profile.typography,
    logo_variants: brandLogoAssets(template).map((asset) => ({ id: asset.id, direction: asset.orientation })),
    ...(chosen
      ? { chosen_logo_slot: { id: chosen.id, direction: chosen.orientation, bounds: chosen.placement } }
      : { candidate_logo_slots: brandLogoSlotContract(template) }),
    rule: chosen
      ? "只为 chosen_logo_slot 保留无遮挡空间；不要绘制、拼写或模拟 Logo。真实原始 Logo 将由系统精确注入。"
      : "Deck Plan 必须按每页实际空白区域、宽窄与方向选择一个 candidate_logo_slots.id；禁止按页型固定分配，不得绘制 Logo。",
  };
}

export function validateBrandLogo(fileName: string, bytes: Buffer, index = 0): {
  fileName: string;
  mediaType: BrandTemplate["logoMediaType"];
  orientation: BrandLogoAsset["orientation"];
  bytes: Buffer;
} {
  if (!bytes.length) throw new Error("Logo 文件为空");
  if (bytes.length > MAX_LOGO_BYTES) throw new Error("Logo 文件不能超过 3MB");
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") {
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("PNG 文件签名不正确");
    }
    return { fileName: assetFileName(index, "png"), mediaType: "image/png", orientation: "square", bytes };
  }
  if (extension !== ".svg") throw new Error("Logo 只支持 SVG 或透明 PNG");
  let svg = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error("SVG Logo 结构不完整");
  if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(svg)
    || /\son[a-z]+\s*=/i.test(svg)
    || /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|javascript:|data:)/i.test(svg)
    || /url\(\s*["']?\s*(?:https?:|data:|javascript:)/i.test(svg)
    || /@import\b/i.test(svg)) {
    throw new Error("SVG Logo 不能引用外部资源");
  }
  if (hasFullCanvasWhiteBackground(svg)) {
    throw new Error("SVG Logo 包含覆盖整个画布的白色背景，请改用透明画布");
  }
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "").trim();
  const dimensions = svgDimensions(svg);
  return {
    fileName: assetFileName(index, "svg"),
    mediaType: "image/svg+xml",
    orientation: classifyOrientation(dimensions.width, dimensions.height),
    bytes: Buffer.from(svg),
  };
}

function placementsForAssets(assets: BrandLogoAsset[]): BrandTemplate["placements"] {
  if (new Set(assets.map((asset) => asset.orientation)).size < 3) return DEFAULT_PLACEMENTS;
  return {
    cover: { x: 876, y: 42, width: 340, height: 92, plate: false },
    toc: { x: 1154, y: 32, width: 62, height: 62, plate: false },
    section: { x: 1144, y: 116, width: 72, height: 276, plate: false },
    content: { x: 1160, y: 30, width: 56, height: 56, plate: false },
    end: { x: 470, y: 610, width: 340, height: 92, plate: false },
  };
}

function svgDimensions(svg: string): { width: number; height: number } {
  const opening = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox = opening.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const width = Number(opening.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1]) || 1;
  const height = Number(opening.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1]) || 1;
  return { width, height };
}

function hasFullCanvasWhiteBackground(svg: string): boolean {
  const dimensions = svgDimensions(svg);
  return [...svg.matchAll(/<rect\b[^>]*>/gi)].some((match) => {
    const rect = match[0];
    const width = svgAttribute(rect, "width");
    const height = svgAttribute(rect, "height");
    const x = svgAttribute(rect, "x") || "0";
    const y = svgAttribute(rect, "y") || "0";
    const fill = svgAttribute(rect, "fill")
      || svgAttribute(rect, "style").match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]
      || "";
    const coversWidth = width === "100%" || Number(width) === dimensions.width;
    const coversHeight = height === "100%" || Number(height) === dimensions.height;
    return coversWidth
      && coversHeight
      && Number(x) === 0
      && Number(y) === 0
      && /^(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(fill.trim());
  });
}

function svgAttribute(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? "";
}

function classifyOrientation(width: number, height: number): BrandLogoAsset["orientation"] {
  const ratio = width / height;
  if (ratio > 1.35) return "wide";
  if (ratio < 0.74) return "tall";
  return "square";
}

function assetFileName(index: number, extension: "svg" | "png"): string {
  return `logo-${index + 1}.${extension}`;
}

function buildBrandProfile(
  name: string,
  organizationName: string,
  primaryColor: string,
  secondaryColor: string,
  style: ReturnType<typeof getStylePack>,
  placements: BrandTemplate["placements"],
): ReferenceStyleProfile {
  return {
    name,
    summary: `${organizationName} 品牌模板：以真实 Logo、品牌色和逐页空间适配构成稳定视觉系统`,
    palette: [style.palette.bg, style.palette.surface, primaryColor, secondaryColor, style.palette.text],
    typography: "沿用基础风格字阶；组织名称和页面标题保持清晰、正式、可连续阅读",
    background: style.background,
    titleSystem: "标题与内容遵守每页 Deck Plan 选定的品牌安全区；同级标题锚点与字阶跨页一致",
    cardSystem: style.decoration,
    imageTreatment: "图片不覆盖品牌层；保持真实、干净和统一裁切",
    chartStyle: `图表使用 ${primaryColor} 为主编码色，${secondaryColor} 为对比色，其余使用灰阶`,
    density: "中等信息密度，品牌元素保持克制",
    pageArchetypes: BRAND_LOGO_SLOTS.map((slot) => ({
      page: slot.id,
      use: `${slot.orientation} Logo 候选安全槽位`,
      layout: `${slot.label} ${JSON.stringify(slot.placement)}`,
      imageRole: "真实 Logo 由系统注入",
    })),
    do: ["保留 Logo 比例", "品牌色承担稳定语义", "内容优先于装饰"],
    dont: ["不要重画 Logo", "不要拉伸 Logo", "不要在页面其他位置生成第二个 Logo"],
  };
}

function readTemplateFile(filePath: string): BrandTemplate | null {
  try {
    return normalizeLoadedTemplate(JSON.parse(fs.readFileSync(filePath, "utf8")) as BrandTemplate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function normalizeLoadedTemplate(template: BrandTemplate): BrandTemplate {
  const assets = brandLogoAssets(template);
  if (new Set(assets.map((asset) => asset.orientation)).size < 2) return template;
  const style = getStylePack(template.baseStyleId);
  return {
    ...template,
    pageLogoAssets: undefined,
    profile: buildBrandProfile(
      template.name,
      template.organizationName,
      template.primaryColor,
      template.secondaryColor,
      style,
      template.placements,
    ),
  };
}

function writeJson(filePath: string, value: unknown) {
  const temp = `${filePath}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("模板 ID 不合法");
  return value;
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeColor(value: string, fallback: string): string {
  const color = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}
