import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BACKGROUND_ART_DIRECTOR, parseArtDirection, backgroundImagePrompt, artDirectionTheme, type BackgroundArtDirection } from "./background-prompts.ts";
import { saveGeneratedTheme, saveThemeUpload, getDesignThemeState } from "./theme-assets.ts";
import { generateJson } from "./model-gateway.ts";
import { generateBackgroundImage, validateImageModel } from "./gotocc-images.ts";
import type { ModelConfig } from "./types.ts";
import { resolveImageSize, type ImageModelConfig } from "./image-config.ts";
import type { ThemeSelection } from "./theme-catalog.ts";

export type BackgroundStatus = "idle" | "planning" | "planned" | "generating_cover" | "generating_body" | "ready" | "failed" | "interrupted";
export interface BackgroundGenerationState {
  id: string; status: BackgroundStatus; brief: string; plan: BackgroundArtDirection | null;
  coverAssetId: string; bodyAssetId: string; candidate: ThemeSelection | null;
  error: string; updatedAt: string; model: string; size: string;
}
export interface BackgroundRequest { mode: "plan" | "generate" | "retry"; brief: string; reusePlan?: boolean; coverPrompt?: string; bodyPrompt?: string }
export const backgroundBusy = (status?: BackgroundStatus) => status === "planning" || status === "generating_cover" || status === "generating_body";
function stateFile(projectId: string, root = path.join(process.cwd(), "data", "artifacts")) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("项目 ID 不合法");
  return path.join(root, projectId, "themes", "generation.json");
}
export function getBackgroundGeneration(projectId: string, root?: string): BackgroundGenerationState {
  try { return JSON.parse(fs.readFileSync(stateFile(projectId, root), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { id: "", status: "idle", brief: "", plan: null, coverAssetId: "", bodyAssetId: "", candidate: null, error: "", updatedAt: "", model: "", size: "" };
  }
}
export function saveBackgroundGeneration(projectId: string, state: BackgroundGenerationState, root?: string) {
  const file = stateFile(projectId, root); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(temp, JSON.stringify(next)); fs.renameSync(temp, file); return next;
}
export function parseBackgroundRequest(input: unknown): BackgroundRequest {
  const body = input as Record<string, unknown>;
  if (!body || !["plan", "generate", "retry"].includes(String(body.mode))) throw new Error("请选择背景生成操作");
  if (typeof body.brief !== "string" || body.brief.length > 5000) throw new Error("视觉要求最多 5000 字符");
  for (const key of ["coverPrompt", "bodyPrompt"]) if (body[key] !== undefined && (typeof body[key] !== "string" || (body[key] as string).length > 10000)) throw new Error("单张图片提示词最多 10000 字符");
  return { mode: body.mode as BackgroundRequest["mode"], brief: body.brief.trim(), reusePlan: body.reusePlan === true, coverPrompt: body.coverPrompt as string | undefined, bodyPrompt: body.bodyPrompt as string | undefined };
}

export async function runBackgroundGeneration(input: {
  projectId: string; request: BackgroundRequest; context: unknown; textConfig: ModelConfig; imageConfig?: ImageModelConfig;
  signal: AbortSignal; onUpdate: (state: BackgroundGenerationState) => void; root?: string;
  dependencies?: { plan?: (messages: { role: "system" | "user"; content: string }[]) => Promise<unknown>; image?: typeof generateBackgroundImage; validate?: typeof validateImageModel };
}) {
  const { projectId, request, signal, root } = input;
  let state = getBackgroundGeneration(projectId, root);
  const write = () => { state = saveBackgroundGeneration(projectId, state, root); input.onUpdate(state); };
  const active = () => { if (signal.aborted) throw new Error("CANCELLED"); };
  try {
    active();
    if (request.mode === "retry") {
      if (!["failed", "interrupted"].includes(state.status)) throw new Error("没有需要重试的背景任务");
      state = { ...state, error: "" };
    } else {
      const reuse = request.reusePlan && state.plan && state.brief === request.brief && request.mode === "generate";
      const plan = reuse ? parseArtDirection({ ...state.plan, coverPrompt: request.coverPrompt ?? state.plan!.coverPrompt, bodyPrompt: request.bodyPrompt ?? state.plan!.bodyPrompt }) : null;
      state = { id: reuse ? state.id : `ai_${crypto.randomUUID()}`, status: "planning", brief: request.brief, plan, coverAssetId: "", bodyAssetId: "", candidate: null, error: "", updatedAt: "", model: "", size: "" };
    }
    if (!state.plan) {
      state.status = "planning"; write();
      const messages: { role: "system" | "user"; content: string }[] = [
        { role: "system", content: BACKGROUND_ART_DIRECTOR },
        { role: "user", content: JSON.stringify({ presentation: input.context, visualRequest: state.brief || "根据当前演示自主设计，画面要有丰富、可信的材质、光影和空间关系。" }) },
      ];
      const raw = input.dependencies?.plan ? await input.dependencies.plan(messages) : await generateJson(input.textConfig, messages, { signal, maxTokens: 6000, temperature: 0.8 });
      active(); state.plan = parseArtDirection(raw); state.status = "planned"; write();
    }
    if (request.mode === "plan") return;
    const config = input.imageConfig;
    if (!config) throw new Error("请先在设置中保存 GotoCC 图片模型配置");
    const needed = Number(!state.coverAssetId) + Number(!state.bodyAssetId);
    if (getDesignThemeState(projectId, root).assets.length + needed > 20) throw new Error("此项目背景已接近 20 张上限，请使用已有背景");
    await (input.dependencies?.validate ?? validateImageModel)(config, signal);
    state.model = config.model;
    for (const role of ["cover", "body"] as const) {
      active();
      const key = role === "cover" ? "coverAssetId" : "bodyAssetId";
      if (state[key]) continue;
      const size = resolveImageSize(role === "cover" ? state.plan.coverSize : state.plan.bodySize);
      state.size = size;
      state.status = role === "cover" ? "generating_cover" : "generating_body"; write();
      const bytes = await (input.dependencies?.image ?? generateBackgroundImage)({ ...config, size }, backgroundImagePrompt(state.plan!, role), signal);
      const asset = await saveThemeUpload(projectId, `${state.plan!.name} · ${role === "cover" ? "封面" : "正文"}`, bytes, root);
      // Persist every successful result before cancellation or the next billed request.
      state[key] = asset.id; write();
    }
    active();
    const definition = artDirectionTheme(state.id, state.plan);
    saveGeneratedTheme(projectId, definition, root);
    state.candidate = { themeId: state.id, intensity: 1, coverAssetId: state.coverAssetId, bodyAssetId: state.bodyAssetId, definition };
    state.status = "ready"; state.error = ""; write();
  } catch (error) {
    state.status = signal.aborted ? "interrupted" : "failed";
    state.error = signal.aborted ? "背景任务已暂停。已成功保存的图片会保留；进行中的图片请求可能已计费，继续项目不会自动重试。" : error instanceof Error ? error.message : "背景生成失败，请手动重试";
    write();
    if (signal.aborted) throw new Error("CANCELLED");
  }
}
