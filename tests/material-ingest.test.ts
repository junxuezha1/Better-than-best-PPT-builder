import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import sharp from "sharp";
import {
  prepareContentMaterials, saveContentMaterials, getContentMaterials, getPreparedSlidePlan,
  readMaterialFile, buildMaterialContext, getMaterialImages, getContentMaterialSummary, setUsePreparedPlan,
} from "../src/lib/content-materials.ts";

function crc32(bytes: Buffer) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; } return (n ^ 0xffffffff) >>> 0; }
function zip(entries: Array<{ name: string; data?: Buffer | string; flags?: number; mode?: number; declaredSize?: number; crc?: number }>) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = Buffer.from(e.data || "data"), payload = deflateRawSync(data), crc = e.crc ?? crc32(data), size = e.declaredSize ?? data.length;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(e.flags || 0, 6); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(payload.length, 18); l.writeUInt32LE(size, 22); l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.flags || 0, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(payload.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(((e.mode || 0o100644) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(l, name, payload); central.push(c, name); offset += l.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const prepareZip = (bytes: Buffer) => prepareContentMaterials([{ name: "pack.zip", bytes }]);

test("ZIP validates original paths, duplicates, encryption, symlinks, CRC and actual output size", async () => {
  for (const name of ["../outside.txt", "/absolute.txt", "C:/unsafe.txt", "folder/../outside.txt", "folder\\..\\outside.txt"]) await assert.rejects(prepareZip(zip([{ name }])), /路径/);
  await assert.rejects(prepareZip(zip([{ name: "same.txt" }, { name: "SAME.txt" }])), /重复/);
  await assert.rejects(prepareZip(zip([{ name: "folder.txt" }, { name: "folder.txt/child.txt" }])), /文件与目录/);
  await assert.rejects(prepareZip(zip([{ name: "secret.txt", flags: 1 }])), /加密/);
  await assert.rejects(prepareZip(zip([{ name: "link.txt", mode: 0o120777 }])), /软链接/);
  await assert.rejects(prepareZip(zip([{ name: "bad.txt", crc: 1 }])), /校验/);
  await assert.rejects(prepareZip(zip([{ name: "bomb.txt", data: Buffer.alloc(2 * 1024 ** 2, "a"), declaredSize: 1 }])), /解压|实际/);
  await assert.rejects(prepareZip(zip([{ name: "large.txt", data: "tiny", declaredSize: 60 * 1024 ** 2 }])), /大小/);
});

test("material preparation validates signatures and rejects active SVG without executing it", async () => {
  await assert.rejects(prepareContentMaterials([{ name: "fake.png", bytes: Buffer.from("not png") }]), /签名/);
  await assert.rejects(prepareContentMaterials([{ name: "fake.pdf", bytes: Buffer.from("not pdf") }]), /签名/);
  await assert.rejects(prepareZip(zip([{ name: "bad.svg", data: '<svg><image href="https://example.com/tracker"/></svg>' }])), /SVG/);
  await assert.rejects(prepareZip(zip([{ name: "bad.svg", data: '<svg><script>alert(1)</script></svg>' }])), /SVG/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareContentMaterials([{ name: "a.txt", bytes: Buffer.from("a") }], { signal: controller.signal }), { name: "AbortError" });
});

test("DOCX text extraction preserves paragraphs and rejects unsafe internal archives", async () => {
  const docx = zip([{ name: "[Content_Types].xml", data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' }, { name: "word/document.xml", data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>' }]);
  const prepared = await prepareContentMaterials([{ name: "facts.docx", bytes: docx }]);
  assert.equal(prepared.files[0].text, "第一段\n第二段");
  await assert.rejects(prepareContentMaterials([{ name: "bad.docx", bytes: zip([{ name: "../word/document.xml" }]) }]), /路径/);
});

test("exact prepared plan, citations, relative assets and backup duration survive temporary sidecar roundtrip", async () => {
  const cwd = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-material-test-"));
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#193347" } }).png().toBuffer();
  const slides = Array.from({ length: 25 }, (_, i) => ({ id: i < 22 ? String(i + 1).padStart(2, "0") : `B${i - 21}`, title: `页面${i + 1}`, content: { text: `事实${i + 1}` }, duration_seconds: i < 22 ? (i === 21 ? 240 : 60) : 999, assets: [i === 1 ? "G01" : "P01"], section: "第一部分", speaker_notes: { narration: "讲述说明" }, slide_citation: "Reports 1949, p.179", elements: [{ x: 999, text: "EXTERNAL_COORDINATE_SECRET" }] }));
  const archive = zip([
    { name: "pack/slides.json", data: JSON.stringify({ project: "求偿案", topic: "人格", slides }) },
    { name: "pack/assets/assets_manifest.json", data: JSON.stringify([{ id: "P01", path: "assets/photo.png", caption: "真实照片", attribution: "Photo author" }, { id: "G01", path: "assets/guide.svg", preview_path: "assets/guide.png", kind: "original_diagram_guide", caption: "重绘图示" }]) },
    { name: "pack/assets/photo.png", data: png }, { name: "pack/assets/guide.png", data: png },
    { name: "pack/assets/guide.svg", data: '<svg xmlns="http://www.w3.org/2000/svg"><text>图示</text></svg>' },
    { name: "pack/preview/01.png", data: png }, { name: "pack/preview/01.json", data: JSON.stringify({ data: "base64SHOULD_NOT_ENTER_CONTEXT" }) },
    { name: "pack/06_逐页预览.html", data: '<script>UNEXECUTED</script>' }, { name: "pack/__MACOSX/._photo", data: "metadata" },
  ]);
  try {
    process.chdir(temp);
    const prepared = await prepareContentMaterials([{ name: "archive.zip", bytes: archive }], { usePreparedPlan: true });
    const manifest = saveContentMaterials("test_project", prepared);
    assert.equal(manifest.preparedPlan?.slides.length, 25);
    assert.equal(manifest.preparedPlan?.mainSlideCount, 22);
    assert.equal(manifest.preparedPlan?.backupSlideCount, 3);
    assert.equal(manifest.preparedPlan?.durationSeconds, 1500);
    assert.equal(getContentMaterials("test_project")?.files.length, 9);
    const plan = getPreparedSlidePlan("test_project")!;
    assert.ok(plan.slides[0].sourceRefs.includes("Reports 1949, p.179"));
    assert.equal(plan.slides[24].hidden, true);
    assert.doesNotMatch(JSON.stringify(plan), /EXTERNAL_COORDINATE_SECRET/);
    const context = buildMaterialContext("test_project", "页面1", 5000);
    assert.match(context, /讲述说明/); assert.doesNotMatch(context, /UNEXECUTED|base64SHOULD_NOT|EXTERNAL_COORDINATE_SECRET/); assert.ok(context.length <= 5000);
    const images = getMaterialImages("test_project", "页面1"); assert.equal(images.length, 1); assert.match(images[0].name, /P01.*真实照片.*Photo author/);
    assert.equal((await sharp(Buffer.from(images[0].data, "base64")).metadata()).width, 1600);
    assert.equal(images[0].referenceOnly, false);
    assert.equal(getMaterialImages("test_project", "页面2")[0].referenceOnly, true);
    assert.equal(readMaterialFile("test_project", images[0].id).bytes.length, png.length);
    assert.equal(getContentMaterialSummary("test_project")?.preparedSlideCount, 25);
    assert.equal(manifest.warnings.length, 2);
    assert.throws(() => readMaterialFile("test_project", "../../outside"), /标识/);
    setUsePreparedPlan("test_project", false); assert.equal(getPreparedSlidePlan("test_project"), null);
    assert.equal(getContentMaterials("no_such_project"), null);
  } finally { process.chdir(cwd); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("ordinary inputs never automatically enable a discovered slide plan", async () => {
  const prepared = await prepareContentMaterials([{ name: "slides.json", bytes: Buffer.from(JSON.stringify({ slides: [{ title: "Title", content: "Fact" }] })) }]);
  assert.equal(prepared.manifest.usePreparedPlan, false);
  assert.equal(prepared.manifest.preparedPlan?.slides.length, 1);
  const ordinary = await prepareContentMaterials([{ name: "facts.txt", bytes: Buffer.from("Fact") }], { usePreparedPlan: true });
  assert.equal(ordinary.manifest.usePreparedPlan, false);
});
