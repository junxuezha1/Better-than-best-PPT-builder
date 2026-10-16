import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { Resvg } from "@resvg/resvg-js";
import { buildPptx, buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { normalizeSvgForSharpText } from "../src/lib/svg-sharpness.ts";
import { isolatedSvg, parseSvg, rasterElement, serialize, svgRenderer } from "../src/lib/svg-pptx-document.ts";
import { nativePath } from "../src/lib/svg-pptx-geometry.ts";
import { designSvgSystem, draftSvgSystem, EDITABLE_SVG_RULES } from "../src/lib/prompts.ts";
import { STYLE_PACKS } from "../src/lib/styles.ts";
import { DEFAULT_CJK_FONT, fontFamily } from "../src/lib/svg-pptx-style.ts";

const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1280 720" width="1280" height="720">${body}</svg>`;
const svg=wrap('<rect width="1280" height="720" fill="#fff"/><text x="80" y="120" font-size="42">PPT Agent 中文</text>');
const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="red"/><rect x="20" width="20" height="20" fill="blue"/></svg>').render().asPng();
const data=`data:image/png;base64,${image.toString("base64")}`;

test("native fonts skip browser system aliases and preserve existing mixed-language mappings",async()=>{
  const aliases='-apple-system, BlinkMacSystemFont, Arial, "PingFang SC", sans-serif';
  assert.equal(fontFamily(aliases,"International Claim"),"Arial");
  assert.equal(fontFamily(aliases,"联合国 UN"),DEFAULT_CJK_FONT);
  const uiAliases='-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
  assert.equal(fontFamily(uiAliases,"核心条文索引："),DEFAULT_CJK_FONT);
  assert.equal(fontFamily(uiAliases,"International Claim"),"Segoe UI");
  assert.equal(fontFamily('"segoe ui", sans-serif',"联合国 UN"),DEFAULT_CJK_FONT);
  assert.equal(fontFamily('"-APPLE-SYSTEM", "blinkmacsystemfont", sans-serif',"UN"),"Arial");
  assert.equal(fontFamily('"-APPLE-SYSTEM", "blinkmacsystemfont", sans-serif',"联合国 UN"),DEFAULT_CJK_FONT);
  const existing=['"PingFang SC", "Hiragino Sans GB", sans-serif','Georgia, serif','Arial, sans-serif'];
  for(const family of existing) for(const text of ["United Nations","联合国 UN"]) {
    assert.equal(fontFamily(`-apple-system, BlinkMacSystemFont, ${family}`,text),fontFamily(family,text));
  }
  const result=await buildPptxDetailed([wrap(`<g font-family="${aliases.replaceAll('"',"'")}"><text x="40" y="100">International Claim</text><text x="40" y="160">联合国 UN</text></g>`)]);
  assert.equal(result.nativeTextCount,2);assert.deepEqual(result.warnings,[]);
  const zip=await JSZip.loadAsync(result.buffer);
  const content=await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.doesNotMatch(content,/-apple-system|BlinkMacSystemFont/i);
  assert.match(content,/<a:latin typeface="Arial"/);
  assert.ok(content.includes(`<a:ea typeface="${DEFAULT_CJK_FONT}"`));
});

test("backup slide visibility survives the export worker and PPTX packaging", async () => {
  const bytes = await buildPptx([{ svg, hidden: false }, { svg, hidden: true, notes: "答疑备用，不计时" }]);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const main = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const backup = await zip.file("ppt/slides/slide2.xml")!.async("string");
  assert.doesNotMatch(main, /<p:sld\b[^>]*\bshow="0"/);
  assert.match(backup, /<p:sld\b[^>]*\bshow="0"/);
  assert.match(await zip.file("ppt/notesSlides/notesSlide2.xml")!.async("string"), /答疑备用/);
});
// A generated 4×2 red JPEG fixture; no filesystem or application data is used.
const jpeg=Buffer.from("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAABKADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgAEAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z","base64");
async function xml(zip:JSZip,file:string) {const entry=zip.file(file);assert.ok(entry,file);return entry.async("string");}
async function checkPackage(bytes:Buffer) {
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const parser=new DOMParser({onError:(level,message)=>{throw new Error(`${level}: ${message}`);}});
  for(const file of Object.values(zip.files)) {
    if(file.dir || !/\.xml$|\.rels$/.test(file.name)) continue;
    const doc=parser.parseFromString(await file.async("string"),"application/xml");
    assert.ok(doc.documentElement,file.name);
    if(!file.name.endsWith(".rels")) continue;
    const sourceDir=file.name==="_rels/.rels"?"":path.posix.dirname(path.posix.dirname(file.name));
    for(const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      if(rel.getAttribute("TargetMode")==="External") continue;
      const target=rel.getAttribute("Target")||"";
      const resolved=path.posix.normalize(path.posix.join(sourceDir,target)).replace(/^\//,"");
      assert.ok(zip.file(resolved),`${file.name} -> ${resolved}`);
    }
  }
  for(const required of ["[Content_Types].xml","ppt/presentation.xml","ppt/slideMasters/slideMaster1.xml","ppt/slideLayouts/slideLayout1.xml","ppt/theme/theme1.xml"]) assert.ok(zip.file(required),required);
  return zip;
}

test("editable export contains ordered native text, shapes, paths and notes in a complete PPTX package",async()=>{
  const first=svg.replace('</svg>','<path d="M 90 220 C 130 150 180 290 240 210 Q 280 180 320 220" fill="none" stroke="#1664ff" stroke-width="3"/></svg>');
  const result=await buildPptxDetailed([{svg:first,notes:"第一张演讲备注\n保留中文"},{svg:svg.replace("PPT Agent 中文","第二页"),notes:"第二张备注"}]);
  assert.equal(result.nativeTextCount,2);assert.equal(result.nativeShapeCount,3);assert.equal(result.nativeImageCount,0);assert.deepEqual(result.warnings,[]);
  const zip=await checkPackage(result.buffer);
  const s1=await xml(zip,"ppt/slides/slide1.xml"),s2=await xml(zip,"ppt/slides/slide2.xml");
  assert.match(s1,/<a:t>PPT Agent 中文<\/a:t>/);assert.match(s1,/<a:custGeom>/);assert.match(s1,/<a:cubicBezTo>/);assert.match(s1,/<a:quadBezTo>/);assert.doesNotMatch(s1,/<p:pic>/);
  assert.match(s2,/<a:t>第二页<\/a:t>/);assert.doesNotMatch(s2,/PPT Agent/);
  assert.match(await xml(zip,"ppt/presentation.xml"),/<p:sldSz cx="12192000" cy="6858000"/);
  assert.match(await xml(zip,"ppt/notesSlides/notesSlide1.xml"),/第一张演讲备注/);
  assert.match(await xml(zip,"ppt/notesSlides/notesSlide2.xml"),/第二张备注/);
  assert.ok(s1.includes(`<a:ea typeface="${DEFAULT_CJK_FONT}"`));
});

test("embedded image remains an original replaceable p:pic with native crop",async()=>{
  const result=await buildPptxDetailed([wrap(`<text x="40" y="60">Image test</text><image id="photo" x="100" y="100" width="200" height="200" preserveAspectRatio="xMidYMid slice" href="${data}"/>`)]);
  assert.equal(result.nativeImageCount,1);assert.deepEqual(result.warnings,[]);
  const zip=await checkPackage(result.buffer);const content=await xml(zip,"ppt/slides/slide1.xml");
  assert.match(content,/<p:pic>/);assert.match(content,/<a:srcRect l="25000" r="25000" t="0" b="0"/);
  assert.doesNotMatch(content,/noSelect="1"/);
  const images=await Promise.all(Object.values(zip.files).filter(f=>/^ppt\/media\/.*\.png$/.test(f.name)).map(f=>f.async("nodebuffer")));
  assert.ok(images.some(bytes=>bytes.equals(image)),"original PNG bytes must be embedded");
});

test("JPEG bytes labelled PNG are repaired and embedded as the original PowerPoint picture",async()=>{
  const mislabeled=wrap(`<image id="legacy-photo" x="100" y="100" width="400" height="200" href="data:image/png;base64,${jpeg.toString("base64")}"/>`);
  const parsed=parseSvg(mislabeled);
  assert.equal(parsed.getElementsByTagName("image")[0].getAttribute("href"),`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  const result=await buildPptxDetailed([mislabeled]);
  assert.equal(result.nativeImageCount,1);assert.deepEqual(result.warnings,[]);
  const zip=await checkPackage(result.buffer);
  const files=Object.values(zip.files).filter(file=>/^ppt\/media\/.*\.(?:jpg|jpeg)$/.test(file.name));
  assert.equal(files.length,1);
  assert.ok((await files[0].async("nodebuffer")).equals(jpeg),"MIME repair must retain the original photo bytes");
  assert.match(await xml(zip,"[Content_Types].xml"),/ContentType="image\/jpeg"/);
  const fidelity=await checkPackage(await buildPptx([mislabeled],{mode:"fidelity"}));
  const png=Object.values(fidelity.files).find(file=>/^ppt\/media\/.*\.png$/.test(file.name));
  assert.ok(png);
  assert.ok((await png.async("nodebuffer")).equals(svgRenderer(serialize(parsed.documentElement!),2560).render().asPng()));
});

test("nested SVG image validation follows the signature and retains nested MIME repairs",async()=>{
  const embed=(source:string)=>wrap(`<image width="400" height="200" href="data:image/png;base64,${Buffer.from(source).toString("base64")}"/>`);
  const nested=`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><image width="4" height="2" href="data:image/png;base64,${jpeg.toString("base64")}"/></svg>`;
  const parsed=parseSvg(embed(nested));
  const repaired=parsed.getElementsByTagName("image")[0].getAttribute("href")||"";
  assert.match(repaired,/^data:image\/svg\+xml;base64,/);
  const inner=Buffer.from(repaired.slice(repaired.indexOf(",")+1),"base64").toString("utf8");
  assert.match(inner,/href="data:image\/jpeg;base64,/);
  const result=await buildPptxDetailed([embed(nested)]);
  assert.equal(result.nativeImageCount,1);assert.deepEqual(result.warnings,[]);
  await checkPackage(result.buffer);
  for(const body of ['<image width="4" height="2" href="file:///private/secret.png"/>','<script>alert(1)</script>','<style>@IMPORT "https://example.com/secret.css";</style>']) {
    assert.throws(()=>parseSvg(embed(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2">${body}</svg>`)),/外部|本机|活动内容|样式引用/);
  }
});

test("local use fallback retains ordinary siblings and transitive references outside defs",async()=>{
  const source=wrap('<rect id="source" x="10" y="20" width="40" height="30" fill="red"/><use id="first" href="#source" x="100"/><g transform="translate(0 100)"><use id="second" xlink:href="#first" x="200"/></g><text x="40" y="600">Editable sibling</text>');
  const doc=parseSvg(source),root=doc.documentElement!;
  const original=serialize(root);
  const target=doc.getElementsByTagName("use")[1];
  const isolated=isolatedSvg(root,target);
  const pixels=svgRenderer(isolated,1280).render().pixels;
  assert.equal(pixels[(125*1280+315)*4+3],255,"the referenced copy must remain visible");
  assert.equal(pixels[(25*1280+15)*4+3],0,"the original source must not paint inside the fallback");
  assert.equal(pixels[(25*1280+115)*4+3],0,"intermediate references must not paint outside the target");
  assert.deepEqual(rasterElement(root,target)?.box,{x:309,y:119,width:42,height:32});
  assert.equal(serialize(root),original,"isolation must not change the document shared by native siblings");
  const result=await buildPptxDetailed([source]);
  assert.equal(result.nativeShapeCount,1);assert.equal(result.nativeTextCount,1);assert.equal(result.warnings.length,2);
  const content=await xml(await checkPackage(result.buffer),"ppt/slides/slide1.xml");
  assert.equal((content.match(/<p:pic>/g)||[]).length,2,"both referenced copies must survive as local pictures");
  assert.match(content,/<a:t>Editable sibling<\/a:t>/);
});

test("legacy class styles, nested transforms and explicit tspan lines remain native",async()=>{
  const result=await buildPptxDetailed([wrap('<defs><style>.body {fill:#113355;font-size:24px;font-weight:700}</style></defs><g transform="translate(50 80)"><g transform="scale(1.5)"><text class="body" x="30" y="60"><tspan x="30" dy="0">第一行</tspan><tspan x="30" dy="36">第二行</tspan></text><circle cx="300" cy="200" r="24" fill="red"/></g></g>')]);
  assert.equal(result.nativeTextCount,2);assert.equal(result.nativeShapeCount,1);assert.deepEqual(result.warnings,[]);
  const zip=await checkPackage(result.buffer);const content=await xml(zip,"ppt/slides/slide1.xml");
  assert.match(content,/第一行/);assert.match(content,/第二行/);assert.match(content,/sz="2700"/);assert.match(content,/113355/);
});

test("complex gradient and masked layers degrade locally without losing editable siblings or z order",async()=>{
  const result=await buildPptxDetailed([wrap('<defs><linearGradient id="gradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><mask id="m"><rect width="1280" height="720" fill="white"/></mask></defs><text x="40" y="60">Before</text><rect id="gradient-box" x="100" y="160" width="300" height="200" fill="url(#gradient)"/><g mask="url(#m)"><circle cx="600" cy="300" r="50" fill="red"/></g><text x="40" y="620">After</text>')]);
  assert.equal(result.nativeTextCount,2);assert.equal(result.warnings.length,2);
  const zip=await checkPackage(result.buffer);const content=await xml(zip,"ppt/slides/slide1.xml");
  assert.equal((content.match(/<p:pic>/g)||[]).length,2);
  assert.ok(content.indexOf('Before')<content.indexOf('<p:pic>'));assert.ok(content.indexOf('After')>content.indexOf('<p:pic>'));
  assert.doesNotMatch(content,/<a:ext cx="12192000" cy="6858000"/);
});

test("image rectangular clip remains a picture and masks do not drop content",async()=>{
  const result=await buildPptxDetailed([wrap(`<defs><clipPath id="clip"><rect x="100" y="100" width="100" height="100"/></clipPath></defs><image x="100" y="100" width="200" height="100" href="${data}" clip-path="url(#clip)"/>`)]);
  assert.equal(result.nativeImageCount,1);assert.deepEqual(result.warnings,[]);
  const content=await xml(await checkPackage(result.buffer),"ppt/slides/slide1.xml");
  assert.match(content,/<a:srcRect l="0" r="50000" t="0" b="0"/);
});

test("fidelity export uses standard complete packaging with one full-page PNG per slide",async()=>{
  const result=await buildPptxDetailed([svg,svg.replace("PPT Agent 中文","Second page")],{mode:"fidelity"});
  assert.equal(result.nativeTextCount,0);
  const zip=await checkPackage(result.buffer);
  for(const i of [1,2]) {const content=await xml(zip,`ppt/slides/slide${i}.xml`);assert.equal((content.match(/<p:pic>/g)||[]).length,1);assert.doesNotMatch(content,/<a:custGeom>|<a:t>/);}
});

test("both export modes retain the user's container-filter sharpness normalization",async()=>{
  const filtered=wrap('<defs><filter id="shadow"><feDropShadow stdDeviation="8"/></filter></defs><g filter="url(#shadow)"><rect width="1280" height="720" fill="#fff"/><text x="80" y="120">PPT Agent</text></g>');
  const normalized=normalizeSvgForSharpText(filtered);
  assert.doesNotMatch(serialize(parseSvg(filtered)),/<g\b[^>]*\bfilter\s*=/);
  const editable=await buildPptxDetailed([filtered]);assert.equal(editable.nativeTextCount,1);assert.equal(editable.warnings.length,0);
  const zip=await JSZip.loadAsync(await buildPptx([filtered],{mode:"fidelity"}));
  const expected=svgRenderer(serialize(parseSvg(normalized).documentElement!),2560).render().asPng();
  const images=await Promise.all(Object.values(zip.files).filter(f=>/^ppt\/media\/.*\.png$/.test(f.name)).map(f=>f.async("nodebuffer")));
  assert.ok(images.some(bytes=>bytes.equals(expected)));
});

test("invalid/missing pages, invalid mode, XML and resource references fail clearly",async()=>{
  await assert.rejects(()=>buildPptx([]),/没有可导出的设计稿/);
  await assert.rejects(()=>buildPptx([svg,""]),/第 2 页/);
  await assert.rejects(()=>buildPptx([svg.replace('1280 720','800 600')]),/画布/);
  await assert.rejects(()=>buildPptx([svg.replace('</text>','')]),/XML/);
  await assert.rejects(()=>buildPptx([svg],{mode:"invalid" as "editable"}),/模式不支持/);
  for(const href of ["https://example.com/private.png","file:///etc/passwd","../data/logo.png"]) {
    await assert.rejects(()=>buildPptx([wrap(`<image href="${href}" width="100" height="100"/>`)]),/外部|本机/);
  }
  await assert.rejects(()=>buildPptx([wrap('<style>@import "https://example.com/style.css";</style>')]),/样式引用/);
  await assert.rejects(()=>buildPptx([wrap('<script>alert(1)</script>')]),/活动内容/);
  await assert.rejects(()=>buildPptx([wrap('<rect onclick="alert(1)" width="100" height="100"/>')]),/事件脚本/);
  await assert.rejects(()=>buildPptx(['<!DOCTYPE svg [<!ENTITY test SYSTEM "file:///etc/passwd">]>'+svg]),/文档实体/);
});

test("path normalization covers relative, arcs, smooth curves and affine transforms",()=>{
  const shape=nativePath('M10 20 h30 v20 c5 5 8 8 10 0 s10 -10 20 0 a20 10 30 0 1 40 20 z',[2,0,0,2,5,7]);
  assert.equal(shape.box.x,25);assert.equal(shape.box.y,47);
  assert.ok(shape.points.some(p=>'curve' in p && p.curve.type==='cubic'));assert.ok(shape.points.some(p=>'close' in p));
});

test("new SVG prompts append editability guidance while legacy SVG remains accepted",()=>{
  for(const pageType of ["cover","toc","section","content","end"] as const) {
    assert.ok(draftSvgSystem(pageType).includes(EDITABLE_SVG_RULES));
    assert.ok(designSvgSystem(STYLE_PACKS[0],pageType).includes(EDITABLE_SVG_RULES));
  }
  assert.ok(parseSvg(svg).documentElement);
});



test("visible descendants of hidden groups survive, while mixed inline anchors fall back only on text",async()=>{
  const input=wrap('<g visibility="hidden"><rect visibility="visible" x="30" y="30" width="100" height="100" fill="red"/></g><text id="mixed" x="500" y="200" font-size="40" text-anchor="middle">One <tspan fill="red">Two</tspan></text><text x="100" y="400">Editable sibling</text>');
  const result=await buildPptxDetailed([input]);
  assert.equal(result.nativeShapeCount,1);assert.equal(result.nativeTextCount,1);
  assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"mixed");
  const content=await xml(await checkPackage(result.buffer),"ppt/slides/slide1.xml");
  assert.match(content,/<p:pic>/);assert.match(content,/Editable sibling/);assert.match(content,/FF0000/);
});


test("child selectors and inherited relative font sizes remain native; advanced selectors degrade their subject",async()=>{
  const result=await buildPptxDetailed([wrap('<style>.card > text {fill:#123456;font-size:150%} rect[data-effect] {fill:red}</style><g class="card" font-size="20"><text x="40" y="60">Native CSS</text></g><rect data-effect="yes" x="200" y="100" width="90" height="80"/><text x="100" y="500">Unaffected</text>')]);
  assert.equal(result.nativeTextCount,2);assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"rect");
  const content=await xml(await checkPackage(result.buffer),"ppt/slides/slide1.xml");
  assert.match(content,/123456/);assert.match(content,/sz="2250"/);assert.match(content,/Unaffected/);
});


test("opacity applied to a multiline text container is preserved through local fallback",async()=>{
  const input=wrap('<text id="faded" x="100" y="100" opacity="0.2"><tspan x="100">One</tspan><tspan x="100" dy="50">Two</tspan></text><text x="100" y="400">Still editable</text>');
  const result=await buildPptxDetailed([input]);
  assert.equal(result.nativeTextCount,1);assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"faded");
  const doc=parseSvg(input);
  const expected=rasterElement(doc.documentElement!,doc.getElementById("faded")!);
  assert.ok(expected);
  const zip=await checkPackage(result.buffer);
  const media=await Promise.all(Object.values(zip.files).filter(f=>/\.png$/.test(f.name)).map(f=>f.async("nodebuffer")));
  assert.ok(media.some(bytes=>bytes.equals(Buffer.from(expected.data.split(",")[1],"base64"))));
});


test("structural CSS keeps the complete tree intact with a whole-page warning",async()=>{
  const input=wrap('<style>.layers rect + rect {fill:blue}</style><g id="layer" class="layers"><rect x="20" y="20" width="100" height="100" fill="red"/><rect x="150" y="20" width="100" height="100" fill="red"/></g><text x="40" y="300">Native title</text>');
  const result=await buildPptxDetailed([input]);
  assert.equal(result.nativeTextCount,0);assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"svg");
  const doc=parseSvg(input),expected=rasterElement(doc.documentElement!,doc.documentElement!);
  assert.ok(expected);
  const zip=await checkPackage(result.buffer);
  const media=await Promise.all(Object.values(zip.files).filter(f=>/\.png$/.test(f.name)).map(f=>f.async("nodebuffer")));
  assert.ok(media.some(bytes=>bytes.equals(Buffer.from(expected.data.split(",")[1],"base64"))));
});
