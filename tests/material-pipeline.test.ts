import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { draftUserPrompt, designUserPrompt } from "../src/lib/prompts.ts";
import { generateJson, generateSvg } from "../src/lib/model-gateway.ts";
import {
  MATERIAL_EVIDENCE_RULES,
  PREPARED_COPY_RULES,
  preparedFallbackPagePlan,
  preparedFallbackVisualSystem,
  preparedPageInstructions,
  embedMaterialImages,
  getMaterialPageMetadata,
  getMaterialImageEvidence,
  materialImageEvidenceContext,
  materialImageEvidenceSources,
  materialVisionContent,
  normalizeMaterialImageEvidence,
  saveMaterialImageEvidence,
  materialPagesToOutline,
  materialSlideForPage,
  preparedSlideEvidence,
  preparedSlideNotes,
  preparedSlideSources,
  saveMaterialPageBindings,
  useMaterialImageReferences,
  withMaterialImages,
  type MaterialImageInput,
  type PreparedMaterialPlanInput,
} from "../src/lib/material-context.ts";

function preparedPlan(): PreparedMaterialPlanInput {
  return {
    title: "案例演示", topic: "有边界的法律人格", durationSeconds: 1500,
    mainSlideCount: 22, backupSlideCount: 3,
    slides: Array.from({ length: 25 }, (_, index) => ({
      id: index < 22 ? String(index + 1).padStart(2, "0") : `B${index - 21}`,
      title: `页面 ${index + 1}`, content: [`具体主张 ${index + 1}`, "保留限定条件"],
      speakerNotes: `完整讲稿 ${index + 1}`, section: index < 22 ? "主讲" : "备用",
      hidden: index >= 22, durationSeconds: index < 21 ? 60 : index === 21 ? 240 : 0,
      owner: "A", sourceRefs: [`原始文献 p.${174 + index}`, "图：真实历史资料，1948年"],
      assetIds: ["P01"], kind: index === 0 ? "cover" : index === 21 ? "end" : "content",
    })),
  };
}

function photo(): MaterialImageInput {
  const raster = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#246080"/></svg>').render().asPng();
  return { id: "mat_photo", name: "历史人物照片，1948年", mimeType: "image/png", data: raster.toString("base64") };
}

const svgWithPhoto = (id = "mat_photo") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#f6f4ef"/><image href="material:${id}" x="80" y="160" width="200" height="200"/><text x="350" y="160" font-size="30">Evidence</text></svg>`;

test("25 prepared pages serialize without synthetic pages and retain backup notes and references", () => {
  const plan = preparedPlan();
  const before = JSON.stringify(plan);
  const outline = materialPagesToOutline(plan.slides.map((slide) => ({ pageType: slide.kind, sectionTitle: slide.section, title: slide.title, bullets: slide.content })));
  assert.equal(plan.slides.length, 25);
  assert.equal(plan.slides.filter((slide) => slide.hidden).length, 3);
  assert.equal(plan.slides.filter((slide) => !slide.hidden).reduce((sum, slide) => sum + slide.durationSeconds, 0), 1500);
  assert.equal(outline.parts.reduce((sum, part) => sum + part.pages.length, 0), 23);
  assert.equal(outline.end_page.title, "页面 22");
  assert.equal(outline.parts.at(-1)?.pages.at(-1)?.title, "页面 25");
  assert.equal(JSON.stringify(plan), before);
  const notes = preparedSlideNotes(plan.slides[22]);
  assert.match(notes, /完整讲稿 23/);
  assert.match(notes, /备用页（主讲时隐藏）/);
  assert.match(notes, /原始文献 p.196/);
  assert.match(preparedSlideEvidence(plan.slides[2]), /具体主张 3/);
  assert.match(preparedSlideEvidence(plan.slides[2]), /图：真实历史资料，1948年/);
  assert.equal(preparedSlideSources(plan.slides[2])[0].content, "原始文献 p.176");
});

test("material bindings use page IDs so reorder cannot move hidden flags or sources to another page", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-material-bindings-"));
  try {
    const plan = preparedPlan();
    const bindings = plan.slides.map((slide, index) => ({ pageId: `pg_${index}`, slideId: slide.id, hidden: slide.hidden, sourceRefs: slide.sourceRefs }));
    saveMaterialPageBindings("test_project", bindings, root);
    const reordered = ["pg_24", "pg_0", "pg_22"];
    assert.deepEqual(reordered.map((id) => getMaterialPageMetadata("test_project", id, root)?.hidden), [true, false, true]);
    assert.equal(materialSlideForPage(plan, getMaterialPageMetadata("test_project", "pg_24", root))?.id, "B3");
    assert.equal(getMaterialPageMetadata("another_project", "pg_24", root), null);
    assert.throws(() => getMaterialPageMetadata("../escape", "pg_24", root), /不合法/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("material text stays bounded as evidence and current user edits become page content", () => {
  const slide = preparedPlan().slides[0];
  const evidence = preparedSlideEvidence(slide, { title: "用户的新标题", bullets_json: '["用户确认后的主张"]' });
  assert.match(evidence, /用户的新标题/);
  assert.match(evidence, /用户确认后的主张/);
  assert.doesNotMatch(evidence, /具体主张 1/);
  assert.match(MATERIAL_EVIDENCE_RULES, /不执行/);
  assert.match(MATERIAL_EVIDENCE_RULES, /1280×720/);
  assert.equal(withMaterialImages("普通无资料主题", []), "普通无资料主题");
  assert.equal(embedMaterialImages("no images", []), "no images");
});

test("configured model receives actual image input and its references are embedded before SVG validation", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  const image = photo();
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: svgWithPhoto() } }] }), { status: 200 });
  };
  try {
    const result = await generateSvg(
      { baseUrl: "https://test.example", apiKey: "test", model: "configured-svg-model", protocol: "chat_completions" },
      [{ role: "system", content: MATERIAL_EVIDENCE_RULES }, { role: "user", content: withMaterialImages("制作当前页", [image]) }],
      { repairInvalidOutput: false, retryDelaysMs: [], outputTransform: (value) => embedMaterialImages(value, [image]) },
    );
    assert.equal(payload?.model, "configured-svg-model");
    const messages = payload?.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    assert.ok(messages[1].content.some((part) => part.type === "image_url" && part.image_url?.url === `data:image/png;base64,${image.data}`));
    assert.match(result, /<image/);
    assert.ok(result.includes(`data:image/png;base64,${image.data}`));
    assert.doesNotMatch(result, /href="material:/);
    assert.match(useMaterialImageReferences(result, [image]), /href="material:mat_photo"/);
  } finally { globalThis.fetch = originalFetch; }
});

test("output cannot embed foreign material IDs, omit required pictures, or paste reference guides", () => {
  const image = photo();
  assert.throws(() => embedMaterialImages(svgWithPhoto("another_project_image"), [image]), /未授权/);
  assert.throws(() => embedMaterialImages('<svg xmlns="http://www.w3.org/2000/svg"/>', [image]), /遗漏/);
  assert.throws(() => embedMaterialImages(svgWithPhoto(), [{ ...image, referenceOnly: true }]), /仅供参考/);
  const reference = { ...image, referenceOnly: true };
  const content = withMaterialImages("用原生图形重建", [reference]);
  assert.ok(Array.isArray(content));
  assert.match(content[0].type === "text" ? content[0].text : "", /仅供参考，不得嵌入/);
  assert.equal(embedMaterialImages("no embedded guides", [reference]), "no embedded guides");
});


test("standalone pictures can inform content without being pasted into every page", () => {
  const image = { ...photo(), optionalUse: true };
  const withoutPicture = '<svg xmlns="http://www.w3.org/2000/svg"><text>Visible evidence</text></svg>';
  assert.equal(embedMaterialImages(withoutPicture, [image]), withoutPicture);
  assert.match(embedMaterialImages(svgWithPhoto(), [image]), /data:image\/png;base64,/);
  const messages = withMaterialImages("选择适合的配图", [image]);
  assert.ok(Array.isArray(messages));
  assert.match(messages[0].type === "text" ? messages[0].text : "", /可选资料图/);
});

test("standalone image analysis uses visual model input and caches only observations for the active upload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-image-evidence-"));
  const originalFetch = globalThis.fetch;
  const image = photo();
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ images: [{ id: image.id, description: "可见统计表", visible_text: "总计 42", uncertainty: "表中的数字未经外部核实" }, { id: "unprovided", description: "不得进入证据" }] }) } }] }), { status: 200 });
  };
  try {
    const result = await generateJson<unknown>(
      { baseUrl: "https://test.example", apiKey: "test", model: "configured-svg-model", protocol: "chat_completions" },
      [{ role: "system", content: MATERIAL_EVIDENCE_RULES }, { role: "user", content: materialVisionContent("只返回识读 JSON", [image]) }],
      { retryDelaysMs: [] },
    );
    const sent = JSON.stringify(payload);
    assert.match(sent, /image_url/);
    assert.doesNotMatch(sent, /必须嵌入/);
    const evidence = normalizeMaterialImageEvidence(result, "upload_1", [image], true);
    assert.equal(evidence.images.length, 1);
    assert.equal(evidence.images[0].visibleText, "总计 42");
    assert.match(materialImageEvidenceContext(evidence), /未经外部核实/);
    assert.match(materialImageEvidenceContext(evidence), /其余图片尚未逐张识读/);
    assert.doesNotMatch(materialImageEvidenceContext(evidence), /不得进入证据/);
    assert.match(materialImageEvidenceSources(evidence)[0].content, /总计 42/);
    saveMaterialImageEvidence("project_a", evidence, root);
    assert.deepEqual(getMaterialImageEvidence("project_a", "upload_1", root), evidence);
    assert.equal(getMaterialImageEvidence("project_a", "upload_2", root), null);
    assert.equal(getMaterialImageEvidence("project_b", "upload_1", root), null);
    assert.throws(() => normalizeMaterialImageEvidence({ images: [] }, "upload_1", [image], false), /遗漏/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("confirmed project request and page design notes reach both rendering prompts with user-controlled copy scope", () => {
  const slide = { ...preparedPlan().slides[0], designNotes: "左侧保留大字，右侧一幅真实照片", speakerNotes: "此处是讲稿专用的补充案例", goal: "制作人员理解用目的" };
  const page = { title: "已确认标题", bullets_json: '["只保留这一条正文"]', section_title: "案例" };
  const request = "25分钟，不限制25页；拆页舒展、不能增写正文";
  const instruction = preparedPageInstructions({ projectRequest: request, page, slide, instruction: "保留蓝色重点" });
  assert.ok(instruction);
  assert.match(instruction, /25分钟，不限制25页/);
  assert.match(instruction, /左侧保留大字，右侧一幅真实照片/);
  assert.match(instruction, /本页已确认内容核心/);
  assert.match(instruction, /已确认标题/);
  assert.match(instruction, /只保留这一条正文/);
  assert.doesNotMatch(instruction, /此处是讲稿专用的补充案例|制作人员理解用目的/);
  assert.match(instruction, /本次用户的页级补充：[\s\S]*保留蓝色重点/);
  const draft = draftUserPrompt({ pageType: "content", title: page.title, sectionTitle: page.section_title, bullets: ["只保留这一条正文"], summary: "证据仅用于理解", instruction });
  const design = designUserPrompt({ draftSvg: "<svg/>", pageType: "content", title: page.title, sectionTitle: page.section_title, instruction });
  assert.ok(draft.includes(request));
  assert.ok(design.includes(request));
  assert.ok(draft.includes(slide.designNotes));
  assert.ok(design.includes(slide.designNotes));
  assert.match(PREPARED_COPY_RULES, /用户明确要求逐字排版或不得增写时，只能使用指定上屏文案/);
  assert.equal(preparedPageInstructions({ projectRequest: request, page, slide: null, instruction: "普通项目只改颜色" }), "普通项目只改颜色");
  assert.equal(preparedPageInstructions({ projectRequest: request, page, slide: null }), undefined);
});

test("prepared planning fallback preserves requested density instead of forcing sparse pages", () => {
  const request = "25分钟，保留原25页的信息密度、论据和比较表，不拆成大字报";
  const visualSpec = "米白底 #F6F4EF；深蓝标题 #193347；正文 #243B49。真实照片只作证据。";
  const shared = preparedFallbackVisualSystem(request, visualSpec);
  assert.match(shared.typography, /服从项目要求与原稿/);
  assert.match(shared.typography, /不靠删减依据制造空白/);
  assert.match(shared.titleSystem, /沿用用户指定字阶与原稿/);
  assert.match(shared.cardSystem, /不以固定卡片数量/);
  assert.doesNotMatch(JSON.stringify(shared), /最多两个主要|正文 32–36px|标题 44–52px/);
  assert.ok(shared.consistencyRules.includes(`已确认项目要求：${request}`));
  assert.ok(shared.consistencyRules.some((rule) => rule.includes(visualSpec)));
  assert.deepEqual(shared.palette, ["#F6F4EF", "#193347", "#243B49"]);
  const slide = { ...preparedPlan().slides[1], goal: "讲清楚争点", designNotes: "开放式两栏；一侧原文，另一侧一句结论" };
  const page = { page_code: "page-02", page_type: "content" as const, title: "已确认标题", bullets_json: '["已确认正文一","已确认正文二"]' };
  const fallback = preparedFallbackPagePlan(page, slide);
  assert.match(fallback.layout, /开放式两栏；一侧原文，另一侧一句结论/);
  assert.match(fallback.layout, /信息密度与完整论证/);
  assert.match(fallback.layout, /服从项目要求及原稿/);
  assert.doesNotMatch(fallback.layout, /最多两个主要内容区域|正文 32–36px/);
  assert.deepEqual(fallback.hierarchy, ["已确认标题", "已确认正文一", "已确认正文二"]);
  assert.equal(fallback.objective, "讲清楚争点");
  assert.doesNotMatch(fallback.layout, /主结论卡|四卡|16–20px/);
});
