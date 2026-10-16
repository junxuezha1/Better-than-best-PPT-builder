import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

const NS={a:"http://schemas.openxmlformats.org/drawingml/2006/main",p:"http://schemas.openxmlformats.org/presentationml/2006/main"};
const elements=(root:Document|Element,namespace:string,localName:string)=>Array.from(root.getElementsByTagNameNS(namespace,localName));
const integerAttributes=new Set(["x","y","cx","cy","w","h","rot","sz","l","r","t","b"]);

export async function checkPptxPackage(bytes:Buffer,options:{mode?:"editable"|"fidelity";slides?:number;notes?:boolean}={}) {
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const parser=new DOMParser({onError:(level,message)=>{throw new Error(`${level}: ${message}`);}});
  const documents=new Map<string,Document>();
  for(const file of Object.values(zip.files)) {
    if(file.dir || !/\.xml$|\.rels$/.test(file.name)) continue;
    const doc=parser.parseFromString(await file.async("string"),"application/xml");
    assert.ok(doc.documentElement,file.name);documents.set(file.name,doc);
    for(const element of Array.from(doc.getElementsByTagName("*"))) {
      if(element.namespaceURI!==NS.a || element.localName==="rect") continue;
      for(const attribute of Array.from(element.attributes)) {
        if(!integerAttributes.has(attribute.name)) continue;
        assert.match(attribute.value,/^-?\d+$/,`${file.name}: ${element.tagName}.${attribute.name} must be a decimal integer`);
        assert.ok(Number.isSafeInteger(Number(attribute.value)),`${file.name}: integer outside safe range`);
      }
    }
    if(!file.name.endsWith(".rels")) continue;
    const sourceDir=file.name==="_rels/.rels"?"":path.posix.dirname(path.posix.dirname(file.name));
    for(const relation of Array.from(doc.getElementsByTagNameNS("*","Relationship"))) {
      if(relation.getAttribute("TargetMode")==="External") continue;
      const target=decodeURIComponent(relation.getAttribute("Target") || "");
      assert.ok(target && !target.includes("\\"),`${file.name}: invalid relationship target`);
      const resolved=path.posix.normalize(target.startsWith("/")?target.slice(1):path.posix.join(sourceDir,target));
      assert.ok(!resolved.startsWith("../") && zip.file(resolved),`${file.name}: missing target ${resolved}`);
    }
  }
  for(const file of ["[Content_Types].xml","_rels/.rels","ppt/presentation.xml","ppt/_rels/presentation.xml.rels"]) assert.ok(documents.has(file),file);
  const presentation=documents.get("ppt/presentation.xml")!;
  const dimensions=elements(presentation,NS.p,"sldSz")[0];
  assert.ok(dimensions,"presentation must have a slide size");
  assert.equal(Number(dimensions.getAttribute("cx"))*9,Number(dimensions.getAttribute("cy"))*16,"16:9 canvas");
  const relations=documents.get("ppt/_rels/presentation.xml.rels")!;
  const relationMap=new Map(Array.from(relations.getElementsByTagNameNS("*","Relationship")).map(element=>[element.getAttribute("Id"),element.getAttribute("Target")]));
  const slideIds=elements(presentation,NS.p,"sldId");
  assert.ok(slideIds.length,"presentation has no slides");
  if(options.slides!==undefined) assert.equal(slideIds.length,options.slides,"page count");
  const counts=[];
  for(const [index,id] of slideIds.entries()) {
    const target=relationMap.get(id.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id"));
    assert.ok(target,"slide relationship missing");
    const slidePath=path.posix.normalize(target.startsWith("/")?target.slice(1):path.posix.join("ppt",target));
    const doc=documents.get(slidePath);assert.ok(doc,slidePath);
    const texts=elements(doc,NS.a,"t");
    const nativeShapes=elements(doc,NS.p,"sp").filter(shape=>elements(shape,NS.a,"custGeom").length || elements(shape,NS.a,"prstGeom").some(geometry=>geometry.getAttribute("prst")!=="rect") || !elements(shape,NS.p,"txBody").length);
    const pictures=elements(doc,NS.p,"pic");
    const count={slide:index+1,textRuns:texts.length,shapes:nativeShapes.length,pictures:pictures.length,crops:elements(doc,NS.a,"srcRect").length};
    if(options.mode==="editable") {
      assert.ok(count.textRuns>0,`slide ${index+1}: no editable text`);
      assert.ok(count.shapes>0,`slide ${index+1}: no native geometry`);
      assert.ok(count.pictures>0,`slide ${index+1}: sample picture missing`);
    }
    if(options.mode==="fidelity") {assert.equal(count.textRuns,0);assert.equal(count.shapes,0);assert.equal(count.pictures,1);}
    if(options.notes) {
      const relsPath=path.posix.join(path.posix.dirname(slidePath),"_rels",`${path.posix.basename(slidePath)}.rels`);
      const rels=documents.get(relsPath);assert.ok(rels);
      const note=Array.from(rels.getElementsByTagNameNS("*","Relationship")).find(element=>element.getAttribute("Type")?.endsWith("/notesSlide"));
      assert.ok(note,`slide ${index+1}: notes missing`);
      const noteTarget=note.getAttribute("Target")!;
      const notePath=path.posix.normalize(noteTarget.startsWith("/")?noteTarget.slice(1):path.posix.join(path.posix.dirname(slidePath),noteTarget));
      const noteDoc=documents.get(notePath);assert.ok(noteDoc);assert.ok(elements(noteDoc,NS.a,"t").some(element=>element.textContent?.includes("验收")),`slide ${index+1}: sample speaker notes lost`);
    }
    counts.push(count);
  }
  assert.ok([...documents.keys()].some(name=>/^ppt\/slideMasters\/.*\.xml$/.test(name)),"slide master missing");
  assert.ok([...documents.keys()].some(name=>/^ppt\/slideLayouts\/.*\.xml$/.test(name)),"slide layout missing");
  assert.ok([...documents.keys()].some(name=>/^ppt\/theme\/.*\.xml$/.test(name)),"theme missing");
  return {bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),slides:counts};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode=process.argv.find(argument=>argument.startsWith("--mode="))?.slice(7);
  if(mode!==undefined && mode!=="editable" && mode!=="fidelity") throw new Error("mode must be editable or fidelity");
  const expectedSlides=process.argv.find(argument=>argument.startsWith("--slides="))?.slice(9);
  const files=process.argv.slice(2).filter(argument=>!argument.startsWith("--"));
  assert.ok(files.length,"Usage: node --experimental-strip-types scripts/check-pptx-package.ts [--mode=editable|fidelity] [--slides=2] [--notes] file.pptx ...");
  const results=[];
  for(const file of files) results.push({file,...await checkPptxPackage(await fs.readFile(file),{mode,slides:expectedSlides?Number(expectedSlides):undefined,notes:process.argv.includes("--notes")})});
  console.log(JSON.stringify(results,null,2));
}
