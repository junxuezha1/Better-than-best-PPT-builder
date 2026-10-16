import assert from "node:assert/strict";
import test from "node:test";
import { injectBrandLogo } from "../src/lib/brand-injector.ts";
import { resolveBrandLogoPlan } from "../src/lib/brand-logo-layout.ts";
import { brandLogoAssetForPage, validateBrandLogo } from "../src/lib/brand-templates.ts";
import { designUserPrompt } from "../src/lib/prompts.ts";
import { extractSvg } from "../src/lib/llm.ts";
import type { BrandTemplate } from "../src/lib/types.ts";

const template: BrandTemplate = {
  id: "tpl_test",
  version: 1,
  name: "测试品牌",
  organizationName: "测试大学",
  organizationType: "school",
  baseStyleId: "brand-clean",
  primaryColor: "#1664FF",
  secondaryColor: "#0F2C59",
  logoFile: "logo.svg",
  logoMediaType: "image/svg+xml",
  placements: {
    cover: { x: 1030, y: 42, width: 186, height: 50, plate: true },
    toc: { x: 1070, y: 42, width: 146, height: 38, plate: true },
    section: { x: 1050, y: 42, width: 166, height: 42, plate: true },
    content: { x: 1080, y: 42, width: 136, height: 34, plate: true },
    end: { x: 552, y: 638, width: 176, height: 42, plate: true },
  },
  profile: {
    name: "测试品牌",
    summary: "测试",
    palette: ["#FFFFFF", "#1664FF", "#0F2C59"],
    typography: "清晰正式",
    background: "浅色",
    titleSystem: "标题避开品牌区",
    cardSystem: "细描边",
    imageTreatment: "统一裁切",
    chartStyle: "品牌色",
    density: "中等",
    pageArchetypes: [],
    do: [],
    dont: [],
  },
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

const slide = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/><text x="80" y="120">品牌测试页</text></svg>';
const logo = Buffer.from('<svg viewBox="0 0 400 100"><defs><linearGradient id="tone"><stop stop-color="#1664FF"/></linearGradient></defs><rect id="mark" width="400" height="100" fill="url(#tone)"/></svg>');

test("brand Logo validation rejects scripts, handlers, and external resources", () => {
  assert.throws(() => validateBrandLogo("logo.svg", Buffer.from('<svg><script /></svg>')), /不安全内容|外部资源/);
  assert.throws(() => validateBrandLogo("logo.svg", Buffer.from('<svg><path onload="alert(1)" /></svg>')), /外部资源/);
  assert.throws(() => validateBrandLogo("logo.svg", Buffer.from('<svg><image href="https://example.com/logo.png" /></svg>')), /外部资源/);
  assert.throws(() => validateBrandLogo("logo.png", Buffer.from("not-png")), /签名不正确/);
  assert.throws(
    () => validateBrandLogo(
      "logo.svg",
      Buffer.from('<svg viewBox="0 0 300 80"><rect width="300" height="80" fill="#FFFFFF"/><path d="M0 0"/></svg>'),
    ),
    /覆盖整个画布的白色背景/,
  );
});

test("multi-asset templates preserve all wide, tall, and square SVG variants", () => {
  const multi: BrandTemplate = {
    ...template,
    logoAssets: [
      { id: "wide", file: "wide.svg", mediaType: "image/svg+xml", orientation: "wide", originalName: "wide.svg" },
      { id: "tall", file: "tall.svg", mediaType: "image/svg+xml", orientation: "tall", originalName: "tall.svg" },
      { id: "square", file: "square.svg", mediaType: "image/svg+xml", orientation: "square", originalName: "square.svg" },
    ],
    pageLogoAssets: { cover: "wide", toc: "square", section: "tall", content: "square", end: "wide" },
  };
  assert.equal(brandLogoAssetForPage(multi, "cover").id, "wide");
  assert.equal(brandLogoAssetForPage(multi, "section").id, "tall");
  assert.equal(brandLogoAssetForPage(multi, "content").id, "square");
  assert.equal(validateBrandLogo("wide.svg", Buffer.from('<svg viewBox="0 0 300 80"></svg>'), 0).orientation, "wide");
  assert.equal(validateBrandLogo("tall.svg", Buffer.from('<svg viewBox="0 0 80 300"></svg>'), 1).orientation, "tall");
  assert.equal(validateBrandLogo("square.svg", Buffer.from('<svg viewBox="0 0 100 100"></svg>'), 2).orientation, "square");
  assert.throws(() => validateBrandLogo("logo.jpg", Buffer.from([0xff, 0xd8, 0xff])), /只支持 SVG 或透明 PNG/);
});

test("brand Logo injection preserves aspect ratio, namespaces IDs, and is idempotent", () => {
  const once = injectBrandLogo(slide, template, "content", { slot: "top-right-wide" }, logo);
  const twice = injectBrandLogo(once, template, "content", { slot: "top-right-wide" }, logo);
  assert.equal((twice.match(/id="brand-layer"/g) ?? []).length, 1);
  assert.equal((twice.match(/<svg\b/g) ?? []).length, 1);
  assert.match(twice, /transform="translate\([^)]+\) scale\([^)]+\)"/);
  assert.match(twice, /id="brand_tpl_test_tone"/);
  assert.match(twice, /url\(#brand_tpl_test_tone\)/);
  assert.match(twice, /BRAND_LAYER_START/);
  assert.doesNotThrow(() => extractSvg(twice));
});

test("brand Logo fallback selects by occupied space instead of page type", () => {
  const multi: BrandTemplate = {
    ...template,
    logoAssets: [
      { id: "wide", file: "wide.svg", mediaType: "image/svg+xml", orientation: "wide", originalName: "wide.svg" },
      { id: "tall", file: "tall.svg", mediaType: "image/svg+xml", orientation: "tall", originalName: "tall.svg" },
      { id: "square", file: "square.svg", mediaType: "image/svg+xml", orientation: "square", originalName: "square.svg" },
    ],
  };
  const rightOccupied = resolveBrandLogoPlan({
    template: multi,
    layout: "左侧设置目录标题，右侧约65%区域纵向排列三段章节索引",
  });
  const rightRailFree = resolveBrandLogoPlan({
    template: multi,
    layout: "主体集中在左侧，右侧连续竖向留白",
  });
  assert.equal(rightOccupied?.slot, "bottom-left-square");
  assert.equal(rightRailFree?.slot, "right-rail-tall");
});

test("brand design prompt reserves the slot and forbids model-drawn Logos", () => {
  const prompt = designUserPrompt({
    draftSvg: slide,
    pageType: "content",
    title: "品牌测试页",
    sectionTitle: null,
    brandContract: { chosen_logo_slot: { id: "top-right-wide" } },
  });
  assert.match(prompt, /Logo 安全区/);
  assert.match(prompt, /不得自行绘制、拼写或模拟 Logo/);
  assert.doesNotMatch(designUserPrompt({ draftSvg: slide, pageType: "content", title: "普通页", sectionTitle: null }), /品牌 Logo/);
});
