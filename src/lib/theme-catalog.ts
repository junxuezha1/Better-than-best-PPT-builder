import type { PageType, StylePack } from "./types.ts";

export interface ThemeSelection {
  themeId: string;
  intensity: number;
  coverAssetId: string;
  bodyAssetId: string;
  definition?: ThemeDefinition;
}
export interface ThemeAsset { id: string; name: string; createdAt: string }
export interface DesignThemeState { selection: ThemeSelection | null; assets: ThemeAsset[]; updatedAt: string }
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  baseStyleId: string;
  palette: StylePack["palette"];
  typography: string;
  containers: string;
}

export const DESIGN_THEMES: ThemeDefinition[] = [
  {
    id: "glacier", name: "冰川科技", description: "通透晶体与冷蓝光线，适合技术方案与产品介绍", baseStyleId: "brand-clean",
    palette: { bg: "#EDF4FC", surface: "#FFFFFF", text: "#122740", muted: "#526A84", accent: "#145CFF", accent2: "#123E79", line: "#D4E2F2" },
    typography: "中文无衬线；封面主标题 54–66px，正文页标题 34–40px，卡片标题 24–28px，正文 20–24px，辅助文字至少 16px。",
    containers: "白色实底或不低于 96% 不透明度，圆角 16px，克制的柔和阴影；减少嵌套边框。",
  },
  {
    id: "midnight", name: "深海光场", description: "深蓝背景与流动光轨，适合前沿技术与发布演示", baseStyleId: "tech-noir",
    palette: { bg: "#08172E", surface: "#122944", text: "#F2F7FF", muted: "#B0C5DD", accent: "#62D5FF", accent2: "#93ADFF", line: "#33506E" },
    typography: "中文无衬线；封面 54–66px，正文标题 34–40px；正文 20–24px，辅助文字至少 16px。深底上使用明亮的冷白正文。",
    containers: "深蓝实底容器 #122944，不低于 96% 不透明度，细边线 #33506E；不要铺满白卡片，不在正文下叠加发光。",
  },
  {
    id: "executive", name: "云白商务", description: "折叠纸面与青绿边缘，适合客户提案与经营汇报", baseStyleId: "brand-clean",
    palette: { bg: "#F4F7F5", surface: "#FFFFFF", text: "#18332E", muted: "#587068", accent: "#087F70", accent2: "#B77C32", line: "#D4E2DC" },
    typography: "中文无衬线；封面 52–64px，正文标题 34–40px；正文 20–24px，辅助文字至少 16px；用字重建立主次。",
    containers: "白色实底，圆角 8px、浅灰绿分隔；避免过多卡片，用对齐和留白组织内容。",
  },
];

export const isGeneratedThemeId = (id: string) => /^ai_[a-f0-9-]{36}$/.test(id);

export function getDesignTheme(id: string, definition?: ThemeDefinition): ThemeDefinition {
  if (isGeneratedThemeId(id) && definition?.id === id) return definition;
  const theme = DESIGN_THEMES.find((item) => item.id === id);
  if (!theme) throw new Error("请选择有效的整套主题");
  return theme;
}

export function parseThemeSelection(value: unknown): ThemeSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("主题设置不完整");
  const input = value as Record<string, unknown>;
  if (typeof input.themeId !== "string") throw new Error("请选择整套主题");
  let definition: ThemeDefinition | undefined;
  if (isGeneratedThemeId(input.themeId)) {
    const def = input.definition as ThemeDefinition | undefined;
    if (!def || def.id !== input.themeId) throw new Error("AI 视觉方案缺失，请重新生成");
    const copy: Record<string, string> = {};
    for (const key of ["name", "description", "typography", "containers"] as const) {
      if (typeof def[key] !== "string" || !def[key].trim() || def[key].length > 1600) throw new Error("AI 视觉规则不完整");
      copy[key] = def[key];
    }
    const palette = {} as ThemeDefinition["palette"];
    for (const key of ["bg", "surface", "text", "muted", "accent", "accent2", "line"] as const) {
      if (!/^#[a-f0-9]{6}$/i.test(def.palette?.[key] ?? "")) throw new Error("AI 视觉配色不合法");
      palette[key] = def.palette[key];
    }
    definition = { id: input.themeId, name: copy.name, description: copy.description, typography: copy.typography, containers: copy.containers, baseStyleId: "brand-clean", palette };
  }
  getDesignTheme(input.themeId, definition);
  if (typeof input.intensity !== "number" || !Number.isFinite(input.intensity) || input.intensity < 0 || input.intensity > 1) throw new Error("背景强度须在 0% 到 100% 之间");
  const asset = (key: string) => {
    const value = input[key] ?? "";
    if (typeof value !== "string" || (value && !/^bg_[a-f0-9-]{36}$/.test(value))) throw new Error("背景图片标识不合法");
    return value;
  };
  const coverAssetId = asset("coverAssetId"), bodyAssetId = asset("bodyAssetId");
  if (definition && (!coverAssetId || !bodyAssetId)) throw new Error("请先生成封面与正文背景");
  return { themeId: input.themeId, intensity: input.intensity, coverAssetId, bodyAssetId, ...(definition ? { definition } : {}) };
}

export function themeRole(pageType: PageType): "cover" | "body" {
  return pageType === "cover" || pageType === "section" || pageType === "end" ? "cover" : "body";
}

export function themeStyle(theme: ThemeDefinition, base: StylePack): StylePack {
  return { ...base, name: theme.name, palette: theme.palette, background: "背景由系统注入；你只生成透明画布上的前景。", decoration: theme.containers, dont: "不画整页底板，不重画背景，不在文字区堆叠装饰。" };
}

export function themeDesignContract(selection: ThemeSelection, pageType: PageType): string {
  const theme = getDesignTheme(selection.themeId, selection.definition);
  return `\n整套主题合同（优先于旧策划稿的底色、配色、装饰与字号）：
主题：${theme.name}。随消息附上实际背景，只供观察；系统会在前景底层注入它，不要重画或嵌入背景。
输出透明根画布，禁止整页 rect/path/image 底板。正文、图形、内容图片独立可编辑。
配色：${JSON.stringify(theme.palette)}。
字阶：${theme.typography} 用户明确指定的信息密度和字号仍优先，不丢失其限定、引用或事实。
内容容器：${theme.containers}
${themeRole(pageType) === "cover" ? "文字安全区：x=72..800，y=100..620。右侧 820..1280 为主视觉区；封面保留标题和必要副标题，避免再铺业务卡片。章节与结束页同样保留大面积留白。" : "正文安全区：x=64..1216，y=56..664。标题区 y=56..120，内容区 y=160..650。背景装饰在边缘；文字须放在与主题配套的实底内容容器上。"}
保留事实、信息主次与阅读顺序；为背景安全区可调整受影响分区，不必锁死旧卡片外框。背景只是装饰，不得从图中推断或补充业务事实。`;
}
