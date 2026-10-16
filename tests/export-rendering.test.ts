import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import JSZip from "jszip";
import { getRenderBudgetUsage, isolatedSvg, measureSvgTextBounds, parseSvg, rasterElement, renderFonts, resetRenderBudget, svgRenderer } from "../src/lib/svg-pptx-document.ts";
import { buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { buildPptxDetailed as buildInProcess } from "../src/lib/export-pptx-core.ts";
import { PptxExportError } from "../src/lib/export-types.ts";

const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${body}</svg>`;
const gradient='<defs><linearGradient id="gradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>';
const limited=(error:unknown)=>error instanceof PptxExportError && error.code==="RESOURCE_LIMIT";

function visible(pixels:Uint8Array) {let count=0;for(let i=3;i<pixels.length;i+=4) if(pixels[i]) count++;return count;}

test("browser system-font aliases avoid full system-font reloads while unknown families still resolve",()=>{
  const ordinary=renderFonts(wrap('<text font-family="sans-serif">中文 Text</text>'));
  const aliases=renderFonts(wrap('<style>text {font-family:-apple-system, BlinkMacSystemFont, sans-serif}</style><text>中文 Text</text>'));
  assert.deepEqual(aliases,ordinary);
  const unknown=renderFonts(wrap('<text font-family="CustomUninstalledTypeface">Text</text>'));
  assert.equal(unknown.loadSystemFonts,true);
  const quoted=renderFonts(wrap('<style>text {font-family:"CustomUninstalledTypeface", sans-serif}</style><text>Text</text>'));
  assert.equal(quoted.loadSystemFonts,true,"quoted CSS families must not disappear at their first quote");
  const arial=renderFonts(wrap('<text font-family="Arial">Text</text>'));
  assert.ok(!arial.fontFiles?.some(file=>/Arial (?:Unicode|Narrow|Rounded|Black)/i.test(file)),"Arial must not load unrelated, large font families with the same prefix");
  assert.deepEqual(renderFonts(wrap('<style>.label {font-family:"Unknown"}</style><rect width="100" height="100"/>')),{loadSystemFonts:false,fontFiles:[]});
});

test("CSS rectangle radii stay editable and match equivalent attribute geometry",async()=>{
  const css=wrap('<style>.vote {rx:6px;ry:4px}</style><rect class="vote" x="20" y="30" width="100" height="60" rx="1" fill="blue"/>');
  const attributes=wrap('<rect x="20" y="30" width="100" height="60" rx="6" ry="4" fill="blue"/>');
  const result=await buildPptxDetailed([css,attributes]);
  assert.equal(result.nativeShapeCount,2);assert.deepEqual(result.warnings,[]);
  const zip=await JSZip.loadAsync(result.buffer);
  const pages=await Promise.all([1,2].map(i=>zip.file(`ppt/slides/slide${i}.xml`)!.async("string")));
  const geometry=pages.map(page=>page.match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/)?.[0]);
  assert.ok(geometry[0]);assert.equal(geometry[0],geometry[1]);
  assert.doesNotMatch(pages.join(""),/<p:pic>/);
});

test("isolated fallback prunes unrelated text but preserves referenced sibling chains and nested styles",()=>{
  resetRenderBudget();
  const source=wrap('<g><style>.blue {fill:blue}</style></g><text x="20" y="300">Unrelated body</text><g id="paint"><rect class="blue" width="30" height="20"/></g><use id="chain" href="#paint"/><use id="target" href="#chain" x="100" y="100"/>');
  const doc=parseSvg(source),root=doc.documentElement!,target=doc.getElementById("target")!;
  const isolated=isolatedSvg(root,target);
  assert.doesNotMatch(isolated,/Unrelated body/);
  assert.match(isolated,/id="paint"/);assert.match(isolated,/id="chain"/);assert.match(isolated,/<style>/);
  const pixels=svgRenderer(isolated,1280).render().pixels;
  assert.deepEqual([...pixels.subarray((110*1280+110)*4,(110*1280+110)*4+4)],[0,0,255,255]);
  assert.equal(visible(pixels),600);
});

test("custom text tracking falls back before measurement but an explicit child override stays native",async()=>{
  const fallback=await buildInProcess([wrap('<text x="80" y="100" letter-spacing="1.5" font-size="24">Spacing fallback 2026</text>')]);
  assert.equal(fallback.warnings.length,1);assert.equal(fallback.nativeTextCount,0);
  assert.equal(getRenderBudgetUsage().textMeasurements,0);
  const override=await buildInProcess([wrap('<text x="80" y="100" letter-spacing="1.5"><tspan letter-spacing="0">Native child override</tspan></text>')]);
  assert.equal(override.nativeTextCount,1);assert.deepEqual(override.warnings,[]);
});

test("meet images tolerate floating-point unity without replacing the original picture",async()=>{
  const sizes=[[1047,422,758,202,432,158],[580,867,6,6,380,382]];
  const pages=sizes.map(([w,h,x,y,width,height])=>{
    const png=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="blue"/></svg>`,{font:{loadSystemFonts:false}}).render().asPng();
    return wrap(`<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${png.toString("base64")}"/>`);
  });
  const result=await buildPptxDetailed(pages);
  assert.equal(result.nativeImageCount,2);assert.deepEqual(result.warnings,[]);
  const zip=await JSZip.loadAsync(result.buffer,{checkCRC32:true});
  for(const i of [1,2]) assert.match(await zip.file(`ppt/slides/slide${i}.xml`)!.async("string"),/<a:srcRect l="0" r="0" t="0" b="0"/);
});

test("local raster preserves percentage geometry and nested viewport pixels",()=>{
  for(const body of [
    '<rect id="target" x="50%" y="20%" width="20%" height="30%" fill="url(#gradient)"/>',
    '<svg id="target" x="50%" y="20%" width="20%" height="30%" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="url(#gradient)"/></svg>',
  ]) {
    resetRenderBudget();
    const source=wrap(gradient+body),doc=parseSvg(source),fallback=rasterElement(doc.documentElement!,doc.getElementById("target")!);
    assert.ok(fallback);
    const original=svgRenderer(source,1280).render().pixels;
    const restored=new Resvg(wrap(`<image x="${fallback.box.x}" y="${fallback.box.y}" width="${fallback.box.width}" height="${fallback.box.height}" href="${fallback.data}"/>`)).render().pixels;
    assert.equal(visible(restored),visible(original));
    // Interior pixels avoid interpolation at the 2× PNG's transparent edge.
    for(const [x,y] of [[660,180],[750,240],[800,300]]) {
      const offset=(y*1280+x)*4;
      for(let channel=0;channel<4;channel++) assert.ok(Math.abs(restored[offset+channel]-original[offset+channel])<=2);
    }
  }
});

test("ancestor sibling CSS preserves resolved blue instead of original red attribute",async()=>{
  const source=wrap('<style>.a + .b rect {fill:blue}</style><g class="a"/><g class="b"><rect x="20" y="20" width="100" height="100" fill="red"/></g><text x="40" y="300">Title</text>');
  const result=await buildPptxDetailed([source]);
  assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"svg");
  assert.equal(result.nativeTextCount,0);
  resetRenderBudget();
  const doc=parseSvg(source),expected=rasterElement(doc.documentElement!,doc.documentElement!);
  assert.ok(expected);
  const zip=await JSZip.loadAsync(result.buffer);
  const png=Object.values(zip.files).find(entry=>/^ppt\/media\/.*\.png$/.test(entry.name));
  assert.ok(png);
  assert.deepEqual(await png.async("nodebuffer"),Buffer.from(expected.data.split(",")[1],"base64"));
  const pixels=new Resvg(wrap(`<image x="${expected.box.x}" y="${expected.box.y}" width="${expected.box.width}" height="${expected.box.height}" href="${expected.data}"/>`)).render().pixels;
  assert.deepEqual([...pixels.subarray((40*1280+40)*4,(40*1280+40)*4+4)],[0,0,255,255]);
});

test("disguised ICNS, JPEG XL and HEIF are rejected before vulnerable dimension dispatch",()=>{
  // A child timeout makes regression to the old infinite loop a finite failure.
  const moduleUrl=new URL("../src/lib/svg-pptx-document.ts",import.meta.url).href;
  const icns=Buffer.alloc(16);icns.write("icns");icns.writeUInt32BE(16,4);icns.write("ic04",8);
  const jxl=Buffer.from([0,0,0,12,74,88,76,32,13,10,135,10,0,0,0,0]);
  const heif=Buffer.alloc(32);heif.writeUInt32BE(32,0);heif.write("ftypheic",4);
  const script=`import {parseSvg} from ${JSON.stringify(moduleUrl)};\nfor(const data of ${JSON.stringify([icns,jxl,heif].map(b=>b.toString("base64")))}) {let rejected=false;try {parseSvg(${JSON.stringify(wrap('<image width="100" height="100" href="data:image/png;base64,IMAGE"/>'))}.replace('IMAGE',data));} catch(e) {if(e.code==='INVALID_SVG') rejected=true;else throw e;}if(!rejected) throw Error('accepted unsupported parser');} console.log('safe');`;
  const result=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",script],{timeout:10_000,encoding:"utf8",cwd:fileURLToPath(new URL("..",import.meta.url))});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/safe/);
});

test("node, decoded image, render and fallback budgets accumulate and reset explicitly",()=>{
  resetRenderBudget();
  const dense=wrap('<rect width="1" height="1"/>'.repeat(14_000));
  parseSvg(dense);parseSvg(dense);assert.throws(()=>parseSvg(dense),limited);
  resetRenderBudget();
  const inner='<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"><rect width="1" height="1"/></svg>';
  const image=wrap(`<image width="1" height="1" href="data:image/svg+xml;base64,${Buffer.from(inner).toString("base64")}"/>`);
  for(let i=0;i<5;i++) parseSvg(image);
  assert.throws(()=>parseSvg(image),limited);
  resetRenderBudget();
  assert.throws(()=>svgRenderer('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2000000"/>',20),limited);
  resetRenderBudget();
  const doc=parseSvg(wrap('<rect id="empty" width="0" height="0"/>'));
  // Every fallback attempt counts, even when its geometry is empty and no
  // bitmap allocation is needed. Optimized crops must not bypass this cap.
  let count=0;
  assert.throws(()=>{for(;count<200;count++) rasterElement(doc.documentElement!,doc.getElementById("empty")!);},limited);
  assert.equal(count,160);
  resetRenderBudget();assert.ok(parseSvg(wrap('<rect width="2" height="2"/>')));
});

test("resource errors survive export and a subsequent child starts with a fresh budget",async()=>{
  const many=wrap(gradient+Array.from({length:161},(_,i)=>`<rect x="${i%60*20}" y="${Math.floor(i/60)*20}" width="10" height="10" fill="url(#gradient)"/>`).join(""));
  await assert.rejects(buildPptxDetailed([many]),limited);
  const next=await buildPptxDetailed([wrap('<text x="40" y="60">Next export works</text>')]);
  assert.equal(next.nativeTextCount,1);
});

test("geometry measurements do not allocate full-page pixels and retain their own work limit",()=>{
  resetRenderBudget();
  const box=measureSvgTextBounds(wrap('<text x="40" y="80" font-size="32">Editable text</text>'));
  assert.ok(box && box.width>0);
  assert.equal(getRenderBudgetUsage().renderedPixels,0);
  assert.equal(getRenderBudgetUsage().textMeasurements,1);
  assert.throws(()=>measureSvgTextBounds(wrap(`<text>${"x".repeat(2_000_001)}</text>`)),limited);
  resetRenderBudget();
  for(let i=0;i<4;i++) svgRenderer('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',10_000);
  assert.throws(()=>svgRenderer('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',10_000),limited);
  resetRenderBudget();
});

test("small local fallback renders its own area while filter spill remains intact",()=>{
  resetRenderBudget();
  const local=parseSvg(wrap(gradient+'<rect id="target" x="100" y="100" width="200" height="100" fill="url(#gradient)"/>'));
  const fallback=rasterElement(local.documentElement!,local.getElementById("target")!);
  assert.ok(fallback);
  assert.ok(getRenderBudgetUsage().renderedPixels<100_000,"a small gradient should not paint a 3.7M-pixel canvas");

  resetRenderBudget();
  const source=wrap('<defs><filter id="shadow" x="-60%" y="-60%" width="220%" height="240%"><feDropShadow dx="20" dy="40" stdDeviation="10"/></filter></defs><rect id="target" x="100" y="100" width="200" height="100" fill="red" filter="url(#shadow)"/>');
  const doc=parseSvg(source),effect=rasterElement(doc.documentElement!,doc.getElementById("target")!);
  assert.ok(effect);
  assert.ok(effect.box.width>200 && effect.box.height>100,"the shadow must survive outside the geometric rect");
  const original=svgRenderer(source,2560).render().pixels;
  const restored=new Resvg(wrap(`<image x="${effect.box.x}" y="${effect.box.y}" width="${effect.box.width}" height="${effect.box.height}" href="${effect.data}"/>`),{fitTo:{mode:"width",value:2560}}).render().pixels;
  assert.deepEqual(restored,original);
});

test("38-page editable export retains 950 native text boxes with 114 small local fallbacks",async()=>{
  const slides=Array.from({length:38},(_,page)=>({
    title:`规模验收 ${page+1}`,
    notes:`第 ${page+1} 页原始备注`,
    svg:wrap(gradient+`<text x="50" y="60" font-size="36">规模验收 ${page+1}</text>`+
      Array.from({length:24},(_,line)=>`<text x="${50+Math.floor(line/12)*600}" y="${110+line%12*43}" font-size="24">第 ${page+1} 页 · 证据 ${line+1}</text>`).join("")+
      Array.from({length:3},(_,item)=>`<rect x="${50+item*380}" y="660" width="200" height="18" fill="url(#gradient)"/>`).join("")),
  }));
  const result=await buildPptxDetailed(slides,{mode:"editable"});
  assert.equal(result.nativeTextCount,950);
  assert.equal(result.warnings.length,114);
  const zip=await JSZip.loadAsync(result.buffer,{checkCRC32:true});
  assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,38);
  const last=await zip.file("ppt/slides/slide38.xml")!.async("string");
  assert.match(last,/<a:t>规模验收 38<\/a:t>/);
  assert.equal((last.match(/<p:pic>/g)||[]).length,3);
  assert.match(await zip.file("ppt/notesSlides/notesSlide38.xml")!.async("string"),/第 38 页原始备注/);
});
