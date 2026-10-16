import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element, Node } from "@xmldom/xmldom";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";
import { imageSize, disableFS, disableTypes, types as imageTypes } from "image-size";
import { normalizeSvgForSharpText } from "./svg-sharpness.ts";
import { PptxExportError } from "./export-types.ts";
import type { Box } from "./svg-pptx-geometry.ts";

// image-size has no published fix for its ICNS/JXL/HEIF parser advisories.
// Restrict both detection entry and the library dispatch table before any bytes
// reach a parser. PptxGenJS only receives normalized PNG/JPEG from this adapter.
const SAFE_IMAGE_TYPES = new Set(["png","jpg","gif","webp","svg"]);
disableFS(true);
disableTypes(imageTypes.filter(type=>!SAFE_IMAGE_TYPES.has(type)) as Parameters<typeof disableTypes>[0]);

export const RENDER_LIMITS = {
  embeddedPixels: 128_000_000,
  renderedPixels: 400_000_000,
  fallbackCount: 160,
  totalNodes: 40_000,
  textMeasurements: 4000,
  measuredCharacters: 2_000_000,
} as const;
let budget={embeddedPixels:0,renderedPixels:0,fallbackCount:0,totalNodes:0,textMeasurements:0,measuredCharacters:0};
/** A child handles one whole job. Never reset between pages or nested images. */
export function resetRenderBudget() { budget={embeddedPixels:0,renderedPixels:0,fallbackCount:0,totalNodes:0,textMeasurements:0,measuredCharacters:0}; }
export function getRenderBudgetUsage() { return { ...budget }; }
function spend(kind:keyof typeof budget,amount:number) {
  if(!Number.isFinite(amount) || amount<0 || budget[kind]+amount>RENDER_LIMITS[kind]) {
    throw new PptxExportError("导出超出累计图片、渲染或元素工作量限制，请拆分文稿或简化效果", "RESOURCE_LIMIT");
  }
  budget[kind]+=amount;
}

export function safeImageType(data:Buffer):string {
  if(data.length>=24 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if(data.length>=4 && data[0]===255 && data[1]===216 && data[2]===255) return "jpg";
  if(data.length>=10 && /^GIF8[79]a$/.test(data.subarray(0,6).toString("ascii"))) return "gif";
  if(data.length>=16 && data.subarray(0,4).toString("ascii")==="RIFF" && data.subarray(8,12).toString("ascii")==="WEBP") return "webp";
  const prefix=data.subarray(0,1024).toString("utf8").replace(/^\uFEFF/,"").trimStart();
  if(/^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) return "svg";
  throw new PptxExportError("嵌入图片的真实格式不支持，只接受 PNG、JPEG、GIF、WebP 或安全 SVG", "INVALID_SVG");
}

export type SvgElement = Element;
export type SvgNode = Node;
export const SVG_NS = "http://www.w3.org/2000/svg";
const serializer = new XMLSerializer();
export const serialize = (node: Node): string => serializer.serializeToString(node);
export const children = (element: Element): Element[] => Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1);
export const attr = (element: Element, name: string): string => element.getAttribute(name) ?? "";
export const tag = (element: Element): string => element.localName || element.tagName;

/** No networking or file resolution is permitted, including within embedded SVG images. */
export function parseSvg(input: string, embedded = false, depth = 0): Document {
  if (Buffer.byteLength(input) > 8*1024*1024 || depth > 3) throw new PptxExportError("SVG 超出导出大小限制", "SVG_LIMIT");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(input)) throw new PptxExportError("SVG 不能包含文档实体或外部样式表", "UNSAFE_SVG");
  let doc: Document;
  try {
    doc = new DOMParser({ onError: (level) => { throw new Error(level); } }).parseFromString(normalizeSvgForSharpText(input), "image/svg+xml");
  } catch { throw new PptxExportError("SVG XML 损坏，请重新生成该页设计稿", "INVALID_SVG"); }
  const root = doc.documentElement;
  if(!root || tag(root) !== "svg" || (root.namespaceURI && root.namespaceURI !== SVG_NS)) throw new PptxExportError("设计稿必须是完整 SVG", "INVALID_SVG");
  const vb = attr(root,"viewBox").trim().split(/[\s,]+/).map(Number);
  if(!embedded && (vb.length !== 4 || vb.some((v,i)=>v !== [0,0,1280,720][i]))) throw new PptxExportError("SVG 画布必须为 1280×720（16:9）", "INVALID_CANVAS");
  if(!embedded) {
    for(const [key,expected] of [["width",1280],["height",720]] as const) {
      const value=attr(root,key).replace(/px$/i,"");
      if(value && Number(value)!==expected) throw new PptxExportError("SVG 画布必须为 1280×720（16:9）", "INVALID_CANVAS");
      root.setAttribute(key,String(expected));
    }
  }
  if(!root.namespaceURI) root.setAttribute("xmlns",SVG_NS);
  let count = 0;
  const check = (element: Element, nesting: number) => {
    spend("totalNodes",1);
    if(++count > 20_000 || nesting > 80) throw new PptxExportError("SVG 元素过多或嵌套过深", "SVG_LIMIT");
    if(["script","foreignObject","iframe","object","embed","audio","video"].includes(tag(element))) throw new PptxExportError("SVG 包含不允许的活动内容", "UNSAFE_SVG");
    for(const a of Array.from(element.attributes)) {
      if(/^on/i.test(a.name)) throw new PptxExportError("SVG 不能包含事件脚本", "UNSAFE_SVG");
      if(a.localName === "href" || a.name === "src") {
        const value=a.value.trim();
        if(value.startsWith("#")) continue;
        if(tag(element) === "image" && /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z\d+/=\s]+$/i.test(value)) {
          let data=Buffer.from(value.slice(value.indexOf(",")+1),"base64");
          if(data.length > 6*1024*1024) throw new PptxExportError("单张图片不能超过 6MB", "SVG_LIMIT");
          try {
            const detected=safeImageType(data);
            if(detected === "svg") data=Buffer.from(serialize(parseSvg(data.toString("utf8"),true,depth+1)),"utf8");
            const size=imageSize(data);
            if(!size.width || !size.height || size.width*size.height>32_000_000) throw new PptxExportError("图片尺寸超过导出上限（3200 万像素）", "SVG_LIMIT");
            spend("embeddedPixels",size.width*size.height);
            // Historical assets can have a .png name but JPEG bytes. Trust the signature.
            const mime=size.type==="jpg" || size.type==="jpeg"?"jpeg":size.type==="svg"?"svg+xml":size.type;
            if(!mime || !["png","jpeg","gif","webp","svg+xml"].includes(mime)) throw new PptxExportError("嵌入图片格式不支持", "INVALID_SVG");
            // Validation must follow the detected format, including SVG bytes
            // incorrectly labelled PNG. Retain repairs made inside nested SVGs.

            element.setAttribute(a.name,`data:image/${mime};base64,${data.toString("base64")}`);
          } catch(error) {
            if(error instanceof PptxExportError) throw error;
            throw new PptxExportError("嵌入图片损坏或格式无效", "INVALID_SVG");
          }
          continue;
        }
        throw new PptxExportError("SVG 含外部或本机文件引用，请先嵌入图片", "UNSAFE_SVG");
      }
      checkCss(a.value);
    }
    if(tag(element) === "style") checkCss(element.textContent || "");
    children(element).forEach(child=>check(child,nesting+1));
  };
  check(root,0);
  return doc;
}

function checkCss(value: string) {
  if(/@import|@font-face|expression\s*\(|javascript:|\\/i.test(value)) throw new PptxExportError("SVG 包含不允许的样式引用", "UNSAFE_SVG");
  for(const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if(!/^['"]?#[\w:.-]+['"]?$/.test(match[1].trim())) throw new PptxExportError("SVG 样式只能引用内部资源", "UNSAFE_SVG");
  }
}

const fontRoots=process.platform==="darwin"
  ? ["/System/Library/Fonts","/System/Library/Fonts/Supplemental","/Library/Fonts"]
  : process.platform==="win32" ? [path.join(process.env.WINDIR||"C:\\Windows","Fonts")]
    : ["/usr/share/fonts","/usr/local/share/fonts"];
let fontFiles:string[]|undefined;
function installedFontFiles():string[] {
  if(fontFiles) return fontFiles;
  fontFiles=[];
  const scan=(dir:string,depth=0)=>{
    if(depth>6) return;
    let entries:fs.Dirent[];try {entries=fs.readdirSync(dir,{withFileTypes:true});} catch {return;}
    for(const entry of entries) {
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()) scan(full,depth+1);
      else if(/\.(?:ttf|ttc|otf)$/i.test(entry.name)) fontFiles!.push(full);
    }
  };
  for(const root of fontRoots) scan(root);
  return [...new Set(fontFiles)];
}
const fontKey=(name:string)=>name.toLowerCase().replace(/[^a-z0-9\u2e80-\u9fff]/g,"");
function fontFileMatches(file:string,family:string):boolean {
  const stem=fontKey(path.basename(file,path.extname(file)));
  return stem===family || (stem.startsWith(family) && /^(?:regular|bold|italic|bolditalic|oblique|boldoblique|light|semibold|medium|thin|bd|bi|i)$/.test(stem.slice(family.length)));
}
export function renderFonts(svg:string):NonNullable<ResvgRenderOptions["font"]> {
  // Reference isolation retains any referenced text. With neither text nor an
  // image (which could embed SVG text), font loading cannot affect the pixels.
  if(!/<(?:[\w-]+:)?(?:text|image)\b/i.test(svg)) return {loadSystemFonts:false,fontFiles:[]};
  const all=installedFontFiles();
  const defaults=all.filter(file=>/^(?:Hiragino Sans GB|Arial(?: Bold| Italic| Bold Italic)?|arial(?:bd|bi|i)?|msyh(?:bd)?|NotoSansCJK-(?:Regular|Bold)|NotoSans-(?:Regular|Bold)|LiberationSans-(?:Regular|Bold))\.(?:ttc|ttf|otf)$/i.test(path.basename(file)));
  // CSS often quotes each family separately; stopping at its first quote would
  // miss Georgia (and other real families) after a browser-system alias.
  const declarations=[...svg.matchAll(/font-family\s*=\s*(["'])(.*?)\1/gi)].map(m=>m[2]);
  declarations.push(...[...svg.matchAll(/font-family\s*:\s*([^;{}<>]+)/gi)].map(m=>m[1]));
  const requested=declarations.flatMap(value=>value.split(",")).map(fontKey).filter(Boolean);
  const selected=all.filter(file=>requested.some(name=>fontFileMatches(file,name)));
  // Browser system-font aliases are not installed family names. Treating them
  // as missing custom fonts makes every local shape reload the entire font DB.
  const known=/^(?:sansserif|serif|monospace|systemui|applesystem|blinkmacsystemfont|segoeui|microsoftyahei|微软雅黑|pingfangsc|hiraginosansgb|notosansc?j?k?sc|arial|helvetica|calibri|aptos|inter)$/;
  const unknown=requested.some(name=>!known.test(name) && !selected.some(file=>fontFileMatches(file,name)));
  const family=process.platform==="darwin"?"Hiragino Sans GB":process.platform==="win32"?"Microsoft YaHei":"Noto Sans CJK SC";
  return {loadSystemFonts:unknown || defaults.length===0,fontFiles:[...new Set([...defaults,...selected])],defaultFontFamily:family,sansSerifFamily:family};
}

export function svgRenderer(svg: string, width = 1920) {
  const renderer=new Resvg(svg, {fitTo:{mode:"width",value:width},font:renderFonts(svg),logLevel:"off"});
  // Includes very tall embedded images whose source width alone looked harmless.
  spend("renderedPixels",Math.ceil(width)*Math.ceil(width*renderer.height/renderer.width));
  return renderer;
}

/** Text shaping reads geometry without allocating or painting a page bitmap. */
export function measureSvgTextBounds(svg: string): Box | null {
  spend("textMeasurements",1);
  spend("measuredCharacters",svg.length);
  const renderer=new Resvg(svg,{font:renderFonts(svg),logLevel:"off"});
  const box=renderer.getBBox();
  return box ? {x:box.x,y:box.y,width:box.width,height:box.height} : null;
}

/** Keep the source tree available to local references while only painting target.
 * SVG permits <use> to reference ordinary rendered siblings, outside <defs>.
 * Wrapping inactive branches in defs retains transitive references and inherited
 * styles without painting a second copy of those siblings in the fallback PNG.
 */
export function isolatedSvg(root: Element, target: Element): string {
  if(root===target) return serialize(root);
  // Retain every reference found anywhere in the source, including transitive
  // hrefs and CSS URLs. Unreferenced siblings cannot paint this isolated target
  // and copying their text/photos into defs still makes Resvg parse that work.
  const referencedIds=new Set<string>();
  const scanReferences=(element:Element) => {
    for(const attribute of Array.from(element.attributes)) {
      if(attribute.localName==="href" && attribute.value.startsWith("#")) referencedIds.add(attribute.value.slice(1));
      for(const match of attribute.value.matchAll(/url\s*\(\s*['"]?#([\w:.-]+)['"]?\s*\)/gi)) referencedIds.add(match[1]);
    }
    if(tag(element)==="style") for(const match of (element.textContent || "").matchAll(/url\s*\(\s*['"]?#([\w:.-]+)['"]?\s*\)/gi)) referencedIds.add(match[1]);
    children(element).forEach(scanReferences);
  };
  scanReferences(root);
  const referenceBranches=new Set<Element>();
  const markReferences=(element:Element) => {
    if(referencedIds.has(attr(element,"id")) || ["style","defs"].includes(tag(element))) {
      let ancestor:Node|null=element;
      while(ancestor && ancestor.nodeType===1) {
        referenceBranches.add(ancestor as Element);
        if(ancestor===root) break;
        ancestor=ancestor.parentNode;
      }
    }
    children(element).forEach(markReferences);
  };
  markReferences(root);
  const active = new Set<Element>([target]);
  let current=target.parentNode;
  while(current) {
    if(current.nodeType === 1) active.add(current as Element);
    if(current === root) break;
    current=current.parentNode;
  }
  if(!active.has(root)) throw new Error("栅格化元素不属于当前 SVG");
  const nonVisual = new Set(["defs","style","title","desc","metadata"]);
  const cloneBranch=(element:Element):Element => {
    if(element === target) return element.cloneNode(true) as Element;
    const copy=element.cloneNode(false) as Element;
    for(const node of Array.from(element.childNodes)) {
      if(node.nodeType !== 1) {copy.appendChild(node.cloneNode(true));continue;}
      const child=node as Element;
      if(active.has(child)) copy.appendChild(cloneBranch(child));
      else if(nonVisual.has(tag(child))) copy.appendChild(child.cloneNode(true));
      else if(referenceBranches.has(child)) {
        const definitions=root.ownerDocument!.createElementNS(SVG_NS,"defs");
        definitions.appendChild(child.cloneNode(true));
        copy.appendChild(definitions);
      }
    }
    return copy;
  };
  return serialize(cloneBranch(root));
}

export function rasterElement(root: Element, element: Element): { data: string; box: Box } | null {
  spend("fallbackCount",1);
  const svg=isolatedSvg(root,element);
  // Resolve percentages, CSS, references and font shaping in the original
  // viewport before cropping the parsed tree. Geometry alone does not include
  // filter output (shadows/blur), so keep pixel probing for those effects.
  const zoom=2,canvasWidth=1280*zoom,canvasHeight=720*zoom;
  const render=new Resvg(svg,{fitTo:{mode:"zoom",value:zoom},font:renderFonts(svg),logLevel:"off"});
  const geometry=render.getBBox();
  const hasFilter=/\bfilter\s*[:=]/i.test(svg);
  if(!hasFilter) {
    if(!geometry) return null;
    const {x,y,width,height}=geometry;
    if(![x,y,width,height].every(Number.isFinite)) throw new PptxExportError("局部内容边界不合法", "INVALID_SVG");
    const left=Math.max(0,Math.floor(x)-1),top=Math.max(0,Math.floor(y)-1);
    const right=Math.min(1280,Math.ceil(x+width)+1),bottom=Math.min(720,Math.ceil(y+height)+1);
    const box={x:left,y:top,width:right-left,height:bottom-top};
    if(box.width<=0 || box.height<=0) return null;
    geometry.x=box.x;geometry.y=box.y;geometry.width=box.width;geometry.height=box.height;
    spend("renderedPixels",box.width*box.height*zoom*zoom);
    render.cropByBBox(geometry);
    const image=render.render();
    const pixels=image.pixels;
    if(!pixels.some((value,index)=>index%4===3 && value>0)) return null;
    return {data:`data:image/png;base64,${image.asPng().toString("base64")}`,box};
  }
  spend("renderedPixels",canvasWidth*canvasHeight);
  const pixels=render.render().pixels;
  let minX=canvasWidth,minY=canvasHeight,maxX=-1,maxY=-1;
  for(let i=3;i<pixels.length;i+=4) if(pixels[i]>0) {
    const p=(i-3)/4,x=p%canvasWidth,y=Math.floor(p/canvasWidth);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  if(maxX<0) return null;
  const x=Math.max(0,Math.floor(minX/zoom)-1),y=Math.max(0,Math.floor(minY/zoom)-1);
  const right=Math.min(1280,Math.ceil((maxX+1)/zoom)+1),bottom=Math.min(720,Math.ceil((maxY+1)/zoom)+1);
  const box={x,y,width:right-x,height:bottom-y};
  if(box.width<=0 || box.height<=0) return null;
  const crop=render.getBBox();
  if(!crop) throw new PptxExportError("局部内容可见但无法确定裁切范围", "EXPORT_FAILED");
  crop.x=x;crop.y=y;crop.width=box.width;crop.height=box.height;
  spend("renderedPixels",box.width*box.height*zoom*zoom);
  render.cropByBBox(crop);
  const image=render.render();
  return {data:`data:image/png;base64,${image.asPng().toString("base64")}`,box};
}
