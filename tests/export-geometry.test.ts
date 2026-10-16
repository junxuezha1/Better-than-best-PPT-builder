import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { Resvg } from "@resvg/resvg-js";
import { buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { IDENTITY, MAX_NATIVE_PX, nativePath, point, type Matrix } from "../src/lib/svg-pptx-geometry.ts";

const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">${body}</svg>`;
const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="red"/><rect x="20" width="20" height="20" fill="blue"/></svg>').render().asPng();
const imageData=`data:image/png;base64,${image.toString("base64")}`;
const parser=new DOMParser({onError:(level,message)=>{throw new Error(`${level}: ${message}`);}});
async function slideXml(buffer:Buffer) {
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  const xml=await zip.file("ppt/slides/slide1.xml")!.async("string");
  return {zip,xml,doc:parser.parseFromString(xml,"application/xml")};
}
function descendants(element:Element,name:string) {return Array.from(element.getElementsByTagName(name));}

test("Z restores the subpath current point before absolute and relative H/V, including affine transforms",()=>{
  const expected=[[10,10],[100,100],null,[200,10],[200,50],[30,40],[60,70],null,[30,100],[120,100]];
  for(const matrix of [IDENTITY,[2,0,0,3,5,7],[1,.5,.25,1,20,30]] as Matrix[]) {
    for(const d of ["M10 10 L100 100 Z H200 V50 M30 40 L60 70 Z V100 H120","M10 10 L100 100 z h190 v40 M30 40 L60 70 z v60 h90"]) {
      const converted=nativePath(d,matrix);
      assert.equal(converted.points.length,expected.length);
      for(const [i,p] of expected.entries()) {
        const actual=converted.points[i];
        if(p===null) {assert.ok("close" in actual);continue;}
        assert.ok("x" in actual && "y" in actual);
        const source=point(matrix,p[0],p[1]);
        assert.ok(Math.abs(converted.box.x+Number(actual.x)*96-source.x)<1e-7,`${d}, point ${i} x`);
        assert.ok(Math.abs(converted.box.y+Number(actual.y)*96-source.y)<1e-7,`${d}, point ${i} y`);
      }
    }
  }
});

test("path endpoints, control points, extents and transformed coordinates are bounded before DrawingML emission",()=>{
  for(const [d,matrix] of [
    ["M0 0 L1e25 10",IDENTITY],
    ["M0 0 C1e25 10 20 30 40 50",IDENTITY],
    [`M-${MAX_NATIVE_PX} 0 L${MAX_NATIVE_PX} 10`,IDENTITY],
    ["M0 0 L10 10",[1e25,0,0,1e25,0,0]],
    ["M0 0 L10 10",[1,0,0,1,Infinity,0]],
  ] as Array<[string,Matrix]>) assert.throws(()=>nativePath(d,matrix),/安全范围/);
});

test("the final DrawingML path retains the endpoint after close",async()=>{
  const result=await buildPptxDetailed([wrap('<path d="M10 10 L100 100 Z H200" fill="none" stroke="red"/>')]);
  assert.equal(result.nativeShapeCount,1);assert.deepEqual(result.warnings,[]);
  const {doc}=await slideXml(result.buffer);
  const path=doc.getElementsByTagName("a:path")[0];
  const lines=descendants(path,"a:lnTo");
  const end=descendants(lines.at(-1)!,"a:pt")[0];
  assert.equal(end.getAttribute("x"),String(190*9525));
  assert.equal(end.getAttribute("y"),"0","the closing segment returns to y=10, not y=100");
});

test("strikethrough and combined decorations remain editable while unsupported decoration falls back locally",async()=>{
  const result=await buildPptxDetailed([wrap('<text x="40" y="60" text-decoration="line-through">Strike</text><text x="40" y="120" text-decoration="underline line-through">Both</text><g text-decoration="underline"><text x="40" y="180" text-decoration="line-through">Inherited</text><text x="40" y="240" text-decoration="none">Cannot erase</text></g><text id="overline" x="40" y="300" text-decoration="overline">Raster only here</text><text x="40" y="360">Sibling</text>')]);
  assert.equal(result.nativeTextCount,5);assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].element,"overline");
  const {doc}=await slideXml(result.buffer);
  const runs=Array.from(doc.getElementsByTagName("a:r"));
  const run=(text:string)=>runs.find(element=>descendants(element,"a:t")[0]?.textContent===text)!;
  assert.equal(descendants(run("Strike"),"a:rPr")[0].getAttribute("strike"),"sngStrike");
  for(const text of ["Both","Inherited"]) {
    const properties=descendants(run(text),"a:rPr")[0];
    assert.equal(properties.getAttribute("strike"),"sngStrike");assert.equal(properties.getAttribute("u"),"sng");
  }
  assert.equal(descendants(run("Cannot erase"),"a:rPr")[0].getAttribute("u"),"sng");
  assert.equal(doc.getElementsByTagName("p:pic").length,1);
});

test("objectBoundingBox percentages and fractions produce identical native image crops",async()=>{
  const result=await buildPptxDetailed([wrap(`<defs><clipPath id="percent" clipPathUnits="objectBoundingBox"><rect x="25%" y="25%" width="50%" height="50%"/></clipPath><clipPath id="fraction" clipPathUnits="objectBoundingBox"><rect x=".25" y=".25" width=".5" height=".5"/></clipPath></defs><image x="100" y="100" width="200" height="100" href="${imageData}" clip-path="url(#percent)"/><image x="500" y="100" width="200" height="100" href="${imageData}" clip-path="url(#fraction)"/>`)]);
  assert.equal(result.nativeImageCount,2);assert.deepEqual(result.warnings,[]);
  const {doc,zip}=await slideXml(result.buffer);
  const crops=Array.from(doc.getElementsByTagName("a:srcRect"));
  assert.equal(crops.length,2);
  for(const crop of crops) for(const edge of ["l","r","t","b"]) assert.equal(crop.getAttribute(edge),"25000");
  const pictures=Array.from(doc.getElementsByTagName("p:pic"));
  assert.equal(descendants(pictures[0],"a:off")[0].getAttribute("x"),String(150*9525));
  assert.equal(descendants(pictures[0],"a:off")[0].getAttribute("y"),String(125*9525));
  assert.equal(descendants(pictures[0],"a:ext")[0].getAttribute("cx"),String(100*9525));
  const media=await Promise.all(Object.values(zip.files).filter(file=>/ppt\/media\/.*\.png$/.test(file.name)).map(file=>file.async("nodebuffer")));
  assert.ok(media.some(bytes=>bytes.equals(image)),"crop must preserve replaceable original bytes");
});

test("oversized native geometry, stroke, text and image fall back without unsafe numeric XML or losing siblings",async()=>{
  const input=wrap(`<rect id="large-shape" transform="scale(10000)" width="1" height="1" fill="red"/><path id="large-stroke" d="M50 300 H400" fill="none" stroke="blue" stroke-width="600"/><text id="large-font" x=".1" y="5" font-size="12" transform="scale(100)">A</text><image id="large-image" width="10000" height="5000" href="${imageData}"/><text x="40" y="660" font-size="28">Safe sibling</text><rect x="100" y="100" width="40" height="40" fill="green"/>`);
  const result=await buildPptxDetailed([input]);
  assert.equal(result.nativeTextCount,1);assert.equal(result.nativeShapeCount,1);assert.equal(result.nativeImageCount,0);
  assert.deepEqual(result.warnings.map(warning=>warning.element),["large-shape","large-stroke","large-font","large-image"]);
  const {doc,xml}=await slideXml(result.buffer);
  assert.equal(doc.getElementsByTagName("p:pic").length,4);
  assert.match(xml,/<a:t>Safe sibling<\/a:t>/);
  for(const element of Array.from(doc.getElementsByTagName("*"))) {
    if(element.tagName==="a:rect") continue; // l/t/r/b are geometry formula names.
    for(const attribute of Array.from(element.attributes)) {
      if(!["x","y","cx","cy","w","h","rot","sz","l","r","t","b"].includes(attribute.name)) continue;
      assert.match(attribute.value,/^-?\d+$/,`${element.tagName} ${attribute.name} must be an integer, never scientific notation`);
      assert.ok(Number.isSafeInteger(Number(attribute.value)));
    }
  }
});
