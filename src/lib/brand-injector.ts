import { brandLogoAssetForPage, readBrandLogo } from "./brand-templates.ts";
import { brandLogoAssetForPlan, brandLogoSlot } from "./brand-logo-layout.ts";
import { normalizeSvgForSharpText } from "./svg-sharpness.ts";
import type { BrandLogoPlan, BrandTemplate, PageType } from "./types.ts";

const LAYER_START = "<!-- BRAND_LAYER_START -->";
const LAYER_END = "<!-- BRAND_LAYER_END -->";

export function injectBrandLogo(
  inputSvg: string,
  template: BrandTemplate | null,
  pageType: PageType,
  brandLogo?: BrandLogoPlan,
  logoOverride?: Buffer,
): string {
  if (!template) return inputSvg;
  const svg = inputSvg.replace(
    new RegExp(`${escapeRegex(LAYER_START)}[\\s\\S]*?${escapeRegex(LAYER_END)}`, "g"),
    "",
  );
  const placement = brandLogo ? brandLogoSlot(brandLogo.slot).placement : template.placements[pageType];
  const asset = brandLogo ? brandLogoAssetForPlan(template, brandLogo) : brandLogoAssetForPage(template, pageType);
  const logo = logoOverride ?? readBrandLogo(template, asset.id);
  const padding = placement.plate ? 8 : 0;
  const logoX = placement.x + padding;
  const logoY = placement.y + padding;
  const logoWidth = Math.max(1, placement.width - padding * 2);
  const logoHeight = Math.max(1, placement.height - padding * 2);
  const plate = placement.plate
    ? `<rect x="${placement.x}" y="${placement.y}" width="${placement.width}" height="${placement.height}" rx="7" fill="#FFFFFF" fill-opacity="0.94" stroke="${template.primaryColor}" stroke-opacity="0.16" />`
    : "";
  const mark = asset.mediaType === "image/svg+xml"
    ? inlineSvgLogo(logo.toString("utf8"), template.id, logoX, logoY, logoWidth, logoHeight)
    : `<image x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMidYMid meet" href="data:${asset.mediaType};base64,${logo.toString("base64")}" />`;
  const layer = `${LAYER_START}<g id="brand-layer" data-brand-template="${template.id}" pointer-events="none">${plate}${mark}</g>${LAYER_END}`;
  return normalizeSvgForSharpText(svg.replace(/<\/svg>\s*$/i, `${layer}</svg>`));
}

function inlineSvgLogo(
  logo: string,
  templateId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const opening = logo.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox = parseViewBox(
    readAttribute(opening, "viewBox"),
    numberAttribute(opening, "width", width),
    numberAttribute(opening, "height", height),
  );
  const inner = logo.replace(/^<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  const namespaced = namespaceIds(inner, `brand_${templateId.replace(/[^a-zA-Z0-9_]/g, "_")}`);
  const scale = Math.min(width / viewBox.width, height / viewBox.height);
  const offsetX = x + (width - viewBox.width * scale) / 2 - viewBox.minX * scale;
  const offsetY = y + (height - viewBox.height * scale) / 2 - viewBox.minY * scale;
  return `<g transform="translate(${formatNumber(offsetX)} ${formatNumber(offsetY)}) scale(${formatNumber(scale)})">${namespaced}</g>`;
}

function parseViewBox(
  value: string | null,
  fallbackWidth: number,
  fallbackHeight: number,
): { minX: number; minY: number; width: number; height: number } {
  const numbers = value?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0) {
    return { minX: numbers[0], minY: numbers[1], width: numbers[2], height: numbers[3] };
  }
  return { minX: 0, minY: 0, width: fallbackWidth, height: fallbackHeight };
}

function formatNumber(value: number): string {
  return Number(value.toFixed(5)).toString();
}

function namespaceIds(svg: string, prefix: string): string {
  const ids = [...svg.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  return ids.reduce((current, id) => {
    const next = `${prefix}_${id.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    const escaped = escapeRegex(id);
    return current
      .replace(new RegExp(`(\\bid\\s*=\\s*["'])${escaped}(["'])`, "g"), `$1${next}$2`)
      .replace(new RegExp(`url\\(\\s*#${escaped}\\s*\\)`, "g"), `url(#${next})`)
      .replace(new RegExp(`((?:href|xlink:href)\\s*=\\s*["'])#${escaped}(["'])`, "g"), `$1#${next}$2`);
  }, svg);
}

function readAttribute(opening: string, name: string): string | null {
  return opening.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function numberAttribute(opening: string, name: string, fallback: number): number {
  const parsed = Number(readAttribute(opening, name)?.replace(/px$/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
