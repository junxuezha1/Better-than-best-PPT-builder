import type {
  BrandLogoAsset,
  BrandLogoPlacement,
  BrandLogoPlan,
  BrandLogoSlotId,
  BrandTemplate,
  VisualSlotPlan,
} from "./types.ts";

export interface BrandLogoSlot {
  id: BrandLogoSlotId;
  orientation: BrandLogoAsset["orientation"];
  placement: BrandLogoPlacement;
  label: string;
}

export const BRAND_LOGO_SLOTS: readonly BrandLogoSlot[] = [
  { id: "top-left-wide", orientation: "wide", placement: { x: 52, y: 34, width: 320, height: 82, plate: false }, label: "左上横向留白" },
  { id: "top-right-wide", orientation: "wide", placement: { x: 908, y: 34, width: 320, height: 82, plate: false }, label: "右上横向留白" },
  { id: "bottom-center-wide", orientation: "wide", placement: { x: 470, y: 610, width: 340, height: 82, plate: false }, label: "底部居中横向留白" },
  { id: "top-left-square", orientation: "square", placement: { x: 52, y: 36, width: 64, height: 64, plate: false }, label: "左上紧凑方形留白" },
  { id: "top-right-square", orientation: "square", placement: { x: 1160, y: 36, width: 64, height: 64, plate: false }, label: "右上紧凑方形留白" },
  { id: "bottom-left-square", orientation: "square", placement: { x: 52, y: 620, width: 64, height: 64, plate: false }, label: "左下紧凑方形留白" },
  { id: "bottom-right-square", orientation: "square", placement: { x: 1164, y: 620, width: 64, height: 64, plate: false }, label: "右下紧凑方形留白" },
  { id: "left-rail-tall", orientation: "tall", placement: { x: 40, y: 190, width: 72, height: 260, plate: false }, label: "左侧竖向留白带" },
  { id: "right-rail-tall", orientation: "tall", placement: { x: 1168, y: 190, width: 72, height: 260, plate: false }, label: "右侧竖向留白带" },
] as const;

export function brandLogoSlot(slotId: BrandLogoSlotId): BrandLogoSlot {
  return BRAND_LOGO_SLOTS.find((slot) => slot.id === slotId) ?? BRAND_LOGO_SLOTS[1];
}

export function brandLogoSlotContract(template: BrandTemplate): Array<Record<string, unknown>> {
  const orientations = new Set(templateLogoAssets(template).map((asset) => asset.orientation));
  return BRAND_LOGO_SLOTS
    .filter((slot) => orientations.has(slot.orientation))
    .map((slot) => ({
      id: slot.id,
      direction: slot.orientation,
      use_when: slot.label,
      bounds: slot.placement,
    }));
}

export function resolveBrandLogoPlan(input: {
  requestedSlot?: unknown;
  template: BrandTemplate | null;
  layout?: string;
  visualSlots?: VisualSlotPlan[];
}): BrandLogoPlan | undefined {
  if (!input.template) return undefined;
  const supported = supportedSlots(input.template);
  const requested = typeof input.requestedSlot === "string"
    ? supported.find((slot) => slot.id === input.requestedSlot)
    : undefined;
  if (requested) return { slot: requested.id };

  const text = planningText(input.layout, input.visualSlots);
  const ranked = supported
    .map((slot, index) => ({ slot, index, score: slotScore(slot, text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return { slot: (ranked[0]?.slot ?? BRAND_LOGO_SLOTS[1]).id };
}

export function brandLogoAssetForPlan(template: BrandTemplate, plan: BrandLogoPlan): BrandLogoAsset {
  const assets = templateLogoAssets(template);
  const orientation = brandLogoSlot(plan.slot).orientation;
  return assets.find((asset) => asset.orientation === orientation) ?? assets[0];
}

export function stripLegacyLogoReservations(value: string): string {
  return value
    .split(/(?<=[。；;])/)
    .filter((part) => !(
      /(?:Logo|logo|品牌).*(?:预留|避让|注入|安全区)|(?:预留|避让).*(?:Logo|logo|品牌)/.test(part)
      || /\bx=\d+[^。；;]*\by=\d+[^。；;]*(?:×|x)\d+/.test(part)
      || /(?:上述区域|预留区不加底板)/.test(part)
    ))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function supportedSlots(template: BrandTemplate): BrandLogoSlot[] {
  const orientations = new Set(templateLogoAssets(template).map((asset) => asset.orientation));
  const exact = BRAND_LOGO_SLOTS.filter((slot) => orientations.has(slot.orientation));
  return exact.length ? [...exact] : [...BRAND_LOGO_SLOTS];
}

function templateLogoAssets(template: BrandTemplate): BrandLogoAsset[] {
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

function planningText(layout = "", visualSlots: VisualSlotPlan[] = []): string {
  const raw = [
    layout,
    ...visualSlots.flatMap((slot) => [slot.placement, slot.purpose]),
  ].join("；");
  const withoutReservations = stripLegacyLogoReservations(raw);
  const rightUpperOccupied = /右侧[^。；;]{0,24}(?:纵向|索引|目录|主内容|高卡|贯穿)|右侧约\d+%/.test(withoutReservations);
  const hints = [
    !rightUpperOccupied && /右上[^。；;]{0,40}(?:Logo|logo|品牌)[^。；;]{0,20}(?:预留|避让)|(?:预留|避让)[^。；;]{0,20}右上[^。；;]{0,20}(?:Logo|logo|品牌)/.test(raw)
      ? "右上横向留白"
      : "",
    /(?:底部|下方)[^。；;]{0,16}(?:中央|居中)[^。；;]{0,40}(?:Logo|logo|品牌)[^。；;]{0,20}(?:预留|避让)|(?:预留|避让)[^。；;]{0,20}(?:底部|下方)[^。；;]{0,16}(?:中央|居中)/.test(raw)
      ? "底部居中横向留白"
      : "",
  ].filter(Boolean).join("；");
  return `${withoutReservations}；${hints}`;
}

function slotScore(slot: BrandLogoSlot, text: string): number {
  let score = slot.orientation === "square" ? 5 : slot.orientation === "wide" ? 3 : -4;
  const occupied = (pattern: RegExp, penalty: number) => {
    if (pattern.test(text)) score -= penalty;
  };

  if (slot.id.startsWith("top-left")) {
    score -= 8;
    occupied(/左上|标题.{0,16}(?:左侧|左对齐)|左侧.{0,16}标题/, 10);
    occupied(/页面左侧|左侧约|左侧设置|左侧以/, 4);
  }
  if (slot.id.startsWith("top-right")) {
    occupied(/右上|顶部.{0,12}右|右侧.{0,16}(?:标题|索引|主视觉|内容|区域)/, 10);
    occupied(/页面右侧|右侧约|右侧设置|右侧以|右侧中上/, 5);
    if (/右上横向留白/.test(text)) score += slot.orientation === "wide" ? 10 : 7;
  }
  if (slot.id.startsWith("bottom-left")) {
    occupied(/左下|底部.{0,16}(?:左侧|左端)|左侧.{0,16}底部/, 10);
    occupied(/底部|中下部/, 4);
    occupied(/左侧[^。；;]{0,24}(?:卡|内容|信息|区域)/, 6);
  }
  if (slot.id.startsWith("bottom-right")) {
    occupied(/右下|底部.{0,16}(?:右侧|右端)|右侧.{0,16}底部/, 10);
    occupied(/底部|中下部/, 4);
    occupied(/右侧[^。；;]{0,24}(?:卡|内容|信息|区域|贯穿)/, 6);
  }
  if (slot.id === "bottom-center-wide") {
    score -= 6;
    occupied(/底部|中下部|居中|中心|收束/, 9);
    if (/底部居中横向留白/.test(text)) score += 22;
  }
  if (slot.id === "left-rail-tall") {
    const explicitlyFree = /左侧[^，。；;]{0,12}(?:连续)?(?:竖向)?(?:留白|空白)|左边栏[^，。；;]{0,12}(?:留白|空白)/.test(text);
    if (explicitlyFree) score += 25;
    else occupied(/左侧|左栏|左半|左起|标题/, 11);
  }
  if (slot.id === "right-rail-tall") {
    const explicitlyFree = /右侧[^，。；;]{0,12}(?:连续)?(?:竖向)?(?:留白|空白)|右边栏[^，。；;]{0,12}(?:留白|空白)/.test(text);
    if (explicitlyFree) score += 25;
    else occupied(/右侧|右栏|右半|右起|主视觉|索引/, 11);
  }

  return score;
}
