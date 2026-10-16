import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_IMAGE_CONFIG, parseImageConfig } from "../src/lib/image-config.ts";
import { getImageSettings, publicImageSettings, saveImageSettings } from "../src/lib/image-settings.ts";
import { generateBackgroundImage, validateImageModel } from "../src/lib/gotocc-images.ts";
import { BACKGROUND_ART_DIRECTOR, parseArtDirection, backgroundImagePrompt } from "../src/lib/background-prompts.ts";
import { runBackgroundGeneration, getBackgroundGeneration } from "../src/lib/background-generation.ts";
import { saveDesignTheme, getDesignThemeState, resolveThemeBackground, validateThemeAssets } from "../src/lib/theme-assets.ts";
import { themeSampleSvg } from "../src/lib/theme-composer.ts";
import { extractSvg } from "../src/lib/llm.ts";
import { parseThemeSelection } from "../src/lib/theme-catalog.ts";

const textConfig = { baseUrl: "https://mock.invalid", apiKey: "fixture", model: "fixture", protocol: "chat_completions" as const };
const imageConfig = { ...DEFAULT_IMAGE_CONFIG, apiKey: "fixture-secret" };
const palette = { bg: "#F2F4F8", surface: "#FFFFFF", text: "#172439", muted: "#576779", accent: "#B84C25", accent2: "#357597", line: "#D2DDE5" };
const plan = {
  name: "流动的交付系统", concept: "从精密核心到真实场景的转化与衔接", visualMotif: "交错的半透明弧形结构连接实体空间", materials: "磨砂玻璃与拉丝铝，两种不同粗糙度的表面", lighting: "左上柔光，右侧暖色反射，环境遮蔽与接触阴影", depth: "近景裁切的结构、中景核心与远景空气透视", palette,
  typography: "大标题 56px，正文 24px，中文无衬线", containers: "浅色实底内容区，明确对齐与留白",
  coverPrompt: "一幅细腻的建筑装置摄影：半透明结构与金属在右侧衔接，左侧保留有空气透视的完整空间，柔光和反射建立材质深度。".repeat(5),
  bodyPrompt: "同一建筑装置的局部剖面视角：磨砂玻璃与拉丝铝构成边缘结构，中心区域保持低对比而有微妙反射，完整保留空间关系。".repeat(5),
};
const bytes = fs.readFileSync(new URL("../public/themes/glacier/cover.jpg", import.meta.url));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ppt-ai-background-"));

test("GotoCC config saves with only key and model, accepts legacy fields and never exposes the key", () => {
  const root = temp();
  try {
    const minimal = parseImageConfig({ apiKey: "fixture-secret", model: "gpt-image-2" });
    assert.equal(minimal.size, "auto");
    assert.deepEqual(parseImageConfig({ ...minimal, groupId: "图片分组", acceptUnknownGroup: false }), minimal);
    assert.equal(parseImageConfig({ apiKey: "", model: minimal.model }, minimal.apiKey).apiKey, minimal.apiKey);
    assert.throws(() => parseImageConfig({ model: minimal.model }), /Key/);
    assert.equal(parseArtDirection(plan).coverSize, "auto");
    assert.equal(parseArtDirection({ ...plan, coverSize: "99999x99999" }).coverSize, "auto");
    const file = path.join(root, "images.json");
    const result = saveImageSettings(imageConfig, file);
    assert.ok(result.configured); assert.equal("apiKey" in result, false);
    assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
    assert.equal(getImageSettings(file).apiKey, "fixture-secret");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(publicImageSettings(DEFAULT_IMAGE_CONFIG).configured, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("GotoCC uses a verified exact model and one billed POST with no automatic retry", async () => {
  const calls: string[] = [];
  const fetcher = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: imageConfig.model }] });
    const request = JSON.parse(String(init?.body));
    assert.equal(request.n, 1); assert.equal(request.size, "auto");
    assert.ok(["low", "medium"].includes(request.quality), "GotoCC rejects quality=auto");
    assert.equal(request.model, imageConfig.model); assert.equal(request.response_format, "b64_json");
    return Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
  };
  await validateImageModel(imageConfig, undefined, fetcher);
  assert.deepEqual(await generateBackgroundImage(imageConfig, backgroundImagePrompt(plan, "cover"), undefined, fetcher), bytes);
  assert.equal(calls.length, 2);
  await assert.rejects(validateImageModel({ ...imageConfig, model: "not-authorized" }, undefined, fetcher), /无权/);
  let failedCalls = 0;
  await assert.rejects(generateBackgroundImage(imageConfig, "valid prompt", undefined, async () => { failedCalls++; return new Response("private key fixture-secret", { status: 503 }); }), (error: Error) => /可能已计费/.test(error.message) && !error.message.includes("fixture-secret"));
  assert.equal(failedCalls, 1);
});

test("content-specific art direction generates two independent assets and waits for confirmation", async () => {
  const root = temp(); const imagePrompts: string[] = []; const sizes: string[] = [];
  try {
    await runBackgroundGeneration({ projectId: "project_a", root, request: { mode: "generate", brief: "暖色的实体交付空间" }, context: { title: "让 AI 落地业务", pages: ["从接入到完整交付"] }, textConfig, imageConfig, signal: new AbortController().signal, onUpdate: () => {}, dependencies: {
      plan: async messages => { assert.equal(messages[0].content, BACKGROUND_ART_DIRECTOR); assert.match(messages[1].content, /从接入到完整交付/); return { ...plan, coverSize: "3840x2160", bodySize: "1536x1024" }; },
      validate: async () => {}, image: async (config, prompt) => { sizes.push(config.size); imagePrompts.push(prompt); return bytes; },
    } });
    const state = getBackgroundGeneration("project_a", root);
    assert.equal(state.status, "ready"); assert.ok(state.candidate); assert.equal(imagePrompts.length, 2);
    assert.deepEqual(sizes, ["3840x2160", "1536x1024"]);
    assert.match(imagePrompts[0], /主视觉位于右侧/); assert.match(imagePrompts[1], /中心 5%/);
    assert.equal(getDesignThemeState("project_a", root).selection, null, "generation alone must not apply the background");
    const selection = parseThemeSelection(state.candidate)!;
    saveDesignTheme("project_a", selection, root);
    assert.equal(getDesignThemeState("project_a", root).selection?.definition?.palette.accent, palette.accent);
    assert.throws(() => validateThemeAssets("project_b", selection, root), /不属于/);
    const svg = themeSampleSvg({ title: "让 AI 落地业务", bullets: ["从接入到交付"], cover: true, selection, background: resolveThemeBackground("project_a", selection, "cover", root) });
    assert.match(extractSvg(svg), /ppt-agent-theme-background/);
    assert.equal(imagePrompts.some(prompt => /模板占位符/.test(prompt)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("image request rejections retain actionable details while redacting credentials and rejecting HTML", async () => {
  let calls = 0;
  await assert.rejects(generateBackgroundImage(imageConfig, "valid prompt", undefined, async () => {
    calls++;
    return Response.json({ error: { message: "Unsupported size: 2560x1440; fixture-secret; Bearer other-secret; sk-other-secret" } }, { status: 400 });
  }), (error: Error) => /Unsupported size: 2560x1440/.test(error.message)
    && /请求被拒绝/.test(error.message) && !/fixture-secret|other-secret|可能已计费/.test(error.message));
  assert.equal(calls, 1);
  await assert.rejects(generateBackgroundImage(imageConfig, "valid prompt", undefined, async () =>
    Response.json({ error: { message: "<html>private provider error</html>" } }, { status: 403 })),
  (error: Error) => /HTTP 403/.test(error.message) && !/private provider|<html>/.test(error.message));
});

test("partial results survive failure and explicit retry only requests the missing image", async () => {
  const root = temp(); let calls = 0, plans = 0;
  const common = { projectId: "retry_project", root, context: { title: "交付" }, textConfig, imageConfig, signal: new AbortController().signal, onUpdate: () => {}, dependencies: {
    plan: async () => { plans++; return plan; }, validate: async () => {},
    image: async () => { calls++; if (calls === 2) throw new Error("网络中断，可能已计费"); return bytes; },
  } };
  try {
    await runBackgroundGeneration({ ...common, request: { mode: "generate", brief: "" } });
    const failed = getBackgroundGeneration("retry_project", root);
    assert.equal(failed.status, "failed"); assert.ok(failed.coverAssetId); assert.equal(failed.bodyAssetId, ""); assert.equal(calls, 2);
    await runBackgroundGeneration({ ...common, request: { mode: "retry", brief: "" } });
    const ready = getBackgroundGeneration("retry_project", root);
    assert.equal(ready.status, "ready"); assert.equal(ready.coverAssetId, failed.coverAssetId); assert.equal(calls, 3); assert.equal(plans, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("prompt-only planning and cancellation never start an unrequested image call", async () => {
  const root = temp(); let images = 0;
  try {
    const common = { projectId: "plan_project", root, context: {}, textConfig, onUpdate: () => {}, dependencies: { plan: async () => plan, validate: async () => {}, image: async () => { images++; return bytes; } } };
    await runBackgroundGeneration({ ...common, request: { mode: "plan", brief: "" }, signal: new AbortController().signal });
    assert.equal(getBackgroundGeneration("plan_project", root).status, "planned"); assert.equal(images, 0);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runBackgroundGeneration({ ...common, request: { mode: "generate", brief: "", reusePlan: true }, imageConfig, signal: controller.signal }), /CANCELLED/);
    assert.equal(images, 0); assert.equal(getBackgroundGeneration("plan_project", root).status, "interrupted");
    assert.throws(() => parseArtDirection({ ...plan, palette: { bg: "blue" } }), /配色/);
    assert.throws(() => parseArtDirection({ ...plan, coverPrompt: "高级科技背景" }), /不完整/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("edited image prompts keep the planned palette and include mandatory no-text composition rules", async () => {
  const root = temp(); let plans = 0;
  const sent: string[] = [];
  const common = { projectId: "edited_project", root, context: {}, textConfig, imageConfig, signal: new AbortController().signal, onUpdate: () => {}, dependencies: { plan: async () => { plans++; return plan; }, validate: async () => {}, image: async (_config: typeof imageConfig, prompt: string) => { sent.push(prompt); return bytes; } } };
  try {
    await runBackgroundGeneration({ ...common, request: { mode: "plan", brief: "同一套空间" } });
    const originalId = getBackgroundGeneration("edited_project", root).id;
    await runBackgroundGeneration({ ...common, request: { mode: "generate", brief: "同一套空间", reusePlan: true, coverPrompt: plan.coverPrompt + "增加温暖的铜色反射。", bodyPrompt: plan.bodyPrompt + "边缘保留细小的拉丝纹理。" } });
    const state = getBackgroundGeneration("edited_project", root);
    assert.equal(plans, 1); assert.equal(state.id, originalId); assert.deepEqual(state.candidate?.definition?.palette, palette);
    assert.match(sent[0], /增加温暖的铜色反射/); assert.match(sent[1], /边缘保留细小的拉丝纹理/);
    assert.ok(sent.every(prompt => prompt.includes("无任何文字") && prompt.includes("整套视觉一致性")));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
