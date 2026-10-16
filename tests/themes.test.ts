import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { DESIGN_THEMES, parseThemeSelection, themeDesignContract } from "../src/lib/theme-catalog.ts";
import { getDesignThemeState, saveDesignTheme, saveThemeUpload, resolveThemeBackground, readThemeUpload } from "../src/lib/theme-assets.ts";
import { composeThemeBackground, stripThemeLayer, themeSampleSvg } from "../src/lib/theme-composer.ts";
import { buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { generateSvg } from "../src/lib/model-gateway.ts";
import { withMaterialImages } from "../src/lib/material-context.ts";
import { withThemeBackground } from "../src/lib/theme-model-context.ts";
import { extractSvg } from "../src/lib/llm.ts";
import { svgRenderer } from "../src/lib/svg-pptx-document.ts";

const choice = { themeId: "glacier", intensity: 1, coverAssetId: "", bodyAssetId: "" };
const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><defs><linearGradient id="fill"><stop stop-color="#fff"/></linearGradient></defs><g><rect id="old-bg" width="1280" height="720" fill="#e0e0e0" opacity="0.8"/><rect id="card" x="64" y="160" width="1152" height="400" fill="#fff"/><text x="96" y="240" font-size="30" fill="#122740">保留事实与引用</text><path d="M96 300L900 300" stroke="#145cff"/></g><g id="brand-layer"><rect x="1160" y="40" width="40" height="40" fill="#00f"/></g></svg>';
const background = () => resolveThemeBackground("test_project", choice, "cover");

test("background composition is reversible and never stacks or changes foreground objects", () => {
  assert.equal(composeThemeBackground(original, null), original);
  const once = composeThemeBackground(original, choice, background());
  const twice = composeThemeBackground(once, { ...choice, intensity: .5 }, background());
  assert.equal((twice.match(/id="ppt-agent-theme-background"/g) ?? []).length, 1);
  assert.equal((twice.match(/data:image\/jpeg/g) ?? []).length, 1);
  assert.match(twice, /opacity="0.5"/);
  assert.match(twice, /id="old-bg"[^>]*opacity="0"/);
  assert.match(twice, /<text x="96" y="240" font-size="30" fill="#122740">保留事实与引用<\/text>/);
  assert.match(twice, /<g id="brand-layer">/);
  assert.equal(stripThemeLayer(twice), original);
  assert.throws(() => composeThemeBackground('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', choice, background()), /不合法/);
});

test("theme upload verifies pixels, normalizes to 16:9 and isolates every project", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-themes-"));
  try {
    assert.deepEqual(getDesignThemeState("project_a", root).selection, null);
    const bytes = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#146cb2" } }).png().toBuffer();
    const asset = await saveThemeUpload("project_a", "portrait.png", bytes, root);
    const jpeg = readThemeUpload("project_a", asset.id, root);
    const meta = await sharp(jpeg).metadata();
    assert.equal(meta.width, 1280); assert.equal(meta.height, 720); assert.equal(meta.format, "jpeg");
    const selection = { ...choice, bodyAssetId: asset.id };
    saveDesignTheme("project_a", selection, root);
    assert.deepEqual(getDesignThemeState("project_a", root).selection, selection);
    assert.deepEqual(resolveThemeBackground("project_a", selection, "content", root), jpeg);
    assert.deepEqual(resolveThemeBackground("project_a", selection, "section", root), background());
    assert.throws(() => readThemeUpload("project_b", asset.id, root), /不属于/);
    assert.throws(() => saveDesignTheme("project_b", selection, root), /不属于/);
    assert.throws(() => getDesignThemeState("../escape", root), /不合法/);
    assert.throws(() => readThemeUpload("project_a", "../../x", root), /不合法/);
    await assert.rejects(saveThemeUpload("project_a", "fake.png", Buffer.from('<svg><script/></svg>'), root), /只支持/);
    await assert.rejects(saveThemeUpload("project_a", "huge.png", Buffer.alloc(11 * 1024 * 1024), root), /10MB/);
    const huge = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "#fff" } }).png().toBuffer();
    await assert.rejects(saveThemeUpload("project_a", "too-many-pixels.png", huge, root), /2400/);
    saveDesignTheme("project_a", null, root);
    assert.equal(getDesignThemeState("project_a", root).selection, null);
    assert.equal(getDesignThemeState("project_a", root).assets.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("untrusted theme settings cannot select arbitrary files or invalid opacity", () => {
  for (const bad of [{ ...choice, themeId: "../x" }, { ...choice, intensity: NaN }, { ...choice, intensity: 1.2 }, { ...choice, bodyAssetId: "../secrets" }, undefined]) assert.throws(() => parseThemeSelection(bad));
  assert.equal(parseThemeSelection(null), null);
  assert.deepEqual(parseThemeSelection(choice), choice);
});

test("all theme assets and real-content samples render and retain editable text in PPTX", async () => {
  const svgs: string[] = [];
  for (const theme of DESIGN_THEMES) for (const cover of [true, false]) {
    const selection = { ...choice, themeId: theme.id };
    const bg = resolveThemeBackground("test_project", selection, cover ? "cover" : "content");
    const meta = await sharp(bg).metadata(); assert.equal(meta.width, 1280); assert.equal(meta.height, 720);
    const svg = themeSampleSvg({ selection, background: bg, cover, title: "让 AI 落地业务", bullets: ["从技术接入到完整交付", "让模型进入现有业务流程", "交付之后持续优化" ] });
    const normalized = extractSvg(svg);
    assert.ok(svgRenderer(normalized).render().asPng().length > 1000);
    svgs.push(normalized);
  }
  const result = await buildPptxDetailed(svgs.map((svg) => ({ svg, notes: "保留讲稿" })), { mode: "editable" });
  assert.equal(result.nativeImageCount, 6); assert.ok(result.nativeTextCount >= 12);
  const zip = await JSZip.loadAsync(result.buffer, { checkCRC32: true });
  for (let i = 1; i <= 6; i++) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`)!.async("string");
    assert.ok(xml.includes("让 AI 落地业务")); assert.match(xml, /<p:pic>/); assert.match(xml, /<a:t>/);
    const doc = new DOMParser({ onError: () => { throw new Error("invalid XML"); } }).parseFromString(xml, "application/xml");
    assert.ok(doc.documentElement);
  }
});

test("mocked model sees actual background while compositor supplies a single managed image", async () => {
  const savedFetch = globalThis.fetch;
  const bg = background();
  let received = false;
  globalThis.fetch = async (_url, init) => {
    received = true;
    const body = JSON.parse(String(init?.body));
    const serialized = JSON.stringify(body.messages);
    assert.ok(serialized.includes(bg.toString("base64"))); assert.ok(serialized.includes("禁止整页"));
    return new Response(JSON.stringify({ choices: [{ message: { content: original } }] }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const content = withThemeBackground(withMaterialImages(themeDesignContract(choice, "content"), []), bg.toString("base64"));
    assert.doesNotMatch(JSON.stringify(content), /必须用原生 SVG 重建/);
    const svg = await generateSvg({ baseUrl: "https://mock.invalid/v1", apiKey: "fixture", protocol: "chat_completions", model: "fixture" }, [{ role: "user", content }], { stream: false, retryDelaysMs: [], repairInvalidOutput: false, outputTransform: (value) => composeThemeBackground(extractSvg(value), choice, bg) });
    assert.ok(received); assert.equal((svg.match(/data:image\/jpeg/g) ?? []).length, 1); assert.match(svg, /保留事实与引用/);
  } finally { globalThis.fetch = savedFetch; }
});
