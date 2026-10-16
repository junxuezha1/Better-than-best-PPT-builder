import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { parseSvg, serialize, svgRenderer } from "../src/lib/svg-pptx-document.ts";
import { DEFAULT_CJK_FONT } from "../src/lib/svg-pptx-style.ts";
import { sampleImage } from "../tests/fixtures/sample-image.ts";

const output=path.resolve(process.argv[2] || "output/editable-pptx-sample");
await fs.mkdir(output,{recursive:true});
const image=sampleImage();
const photo=`data:image/png;base64,${image.toString("base64")}`;
const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="${DEFAULT_CJK_FONT}, Noto Sans CJK SC, Microsoft YaHei, sans-serif">${body}</svg>`;
const slides=[{
  title:"原生对象与图片",
  notes:"验收：修改标题和数字；选中右侧图片，执行更换图片与裁切；编辑下方贝塞尔曲线的顶点。页面顺序为第一张。",
  svg:wrap(`<rect width="1280" height="720" fill="#F5F7FA"/>
    <text id="title" data-pptx-role="title" x="72" y="102" font-size="42" font-weight="700" fill="#13243A">SVG 可编辑导出</text>
    <text x="74" y="156" font-size="23" fill="#526176">文字、图形、曲线与图片保留为独立对象</text>
    <rect x="72" y="216" width="540" height="338" rx="20" fill="#FFFFFF" stroke="#D7DEE7" stroke-width="2"/>
    <text id="metric" data-pptx-role="number" x="108" y="315" font-size="64" font-weight="700" fill="#1664FF">1280 × 720</text>
    <text x="110" y="371" font-size="24" fill="#13243A"><tspan x="110" dy="0">标题、正文与数字可以修改</tspan><tspan x="110" dy="42">图片可以替换与重新裁切</tspan></text>
    <circle cx="120" cy="490" r="11" fill="#1664FF"/>
    <line x1="148" y1="490" x2="330" y2="490" stroke="#1664FF" stroke-width="3"/>
    <path id="curve" d="M 365 490 C 390 430 435 540 480 475 Q 510 430 555 490" fill="none" stroke="#0F2C59" stroke-width="4"/>
    <image id="picture" data-pptx-role="image" x="660" y="216" width="548" height="338" preserveAspectRatio="xMidYMid slice" href="${photo}"/>
    <text x="74" y="651" font-size="18" fill="#526176">原生对象与图片</text><text x="1208" y="651" text-anchor="end" font-size="18" fill="#526176">01</text>`),
},{
  title:"局部效果与页面顺序",
  notes:"验收：这是第二张。左侧渐变与阴影是局部图片；标题、正文、右侧圆形和底部曲线仍可编辑。备注需在打开及另存后保留。",
  svg:wrap(`<defs><linearGradient id="gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1664FF"/><stop offset="1" stop-color="#0F2C59"/></linearGradient><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="15" stdDeviation="12" flood-opacity="0.25"/></filter></defs>
    <rect width="1280" height="720" fill="#F5F7FA"/>
    <text id="title" x="72" y="102" font-size="42" font-weight="700" fill="#13243A">复杂效果局部保留</text>
    <text x="74" y="156" font-size="23" fill="#526176">渐变与阴影转为局部图片，其余内容继续编辑</text>
    <rect id="effect" x="88" y="230" width="520" height="294" rx="28" fill="url(#gradient)" filter="url(#shadow)"/>
    <text x="128" y="306" font-size="28" fill="white">这一行仍是可编辑文本</text>
    <text x="128" y="360" font-size="21" fill="white">效果层与文字层保持原先的顺序</text>
    <g transform="translate(830 375) rotate(15)"><circle r="120" fill="#DCE9FF" stroke="#1664FF" stroke-width="3"/><text x="0" y="10" text-anchor="middle" font-size="32" font-weight="700" fill="#1664FF">原生形状</text></g>
    <path d="M 700 562 C 820 488 946 628 1140 534" fill="none" stroke="#0F2C59" stroke-width="4"/>
    <text x="74" y="651" font-size="18" fill="#526176">局部效果与页面顺序</text><text x="1208" y="651" text-anchor="end" font-size="18" fill="#526176">02</text>`),
}];
const reports=[];
for(const mode of ["editable","fidelity"] as const) {
  const result=await buildPptxDetailed(slides,{mode,title:"SVG 导出验收样例"});
  const filename=path.join(output,`svg-export-${mode}.pptx`);
  await fs.writeFile(filename,result.buffer);
  const zip=await JSZip.loadAsync(result.buffer,{checkCRC32:true});
  const counts=[];
  for(let i=1;i<=slides.length;i++) {
    const xml=await zip.file(`ppt/slides/slide${i}.xml`)!.async("string");
    counts.push({slide:i,textRuns:(xml.match(/<a:t>/g)||[]).length,shapes:(xml.match(/<a:custGeom>/g)||[]).length,pictures:(xml.match(/<p:pic>/g)||[]).length});
  }
  reports.push({mode,bytes:result.buffer.length,counts,warnings:result.warnings});
}
for(const [i,slide] of slides.entries()) {
  await fs.writeFile(path.join(output,`source-${i+1}.svg`),slide.svg);
  await fs.writeFile(path.join(output,`source-${i+1}.png`),svgRenderer(serialize(parseSvg(slide.svg).documentElement!),1280).render().asPng());
}
await fs.writeFile(path.join(output,"inspection.json"),JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
