import pptxgen from "pptxgenjs";
import { imageSize } from "image-size";
import { attr, children, measureSvgTextBounds, rasterElement, svgRenderer, tag, type SvgElement, type SvgNode } from "./svg-pptx-document.ts";
import { color, fontFamily, length, opacity, styleResolver, type SvgStyle } from "./svg-pptx-style.ts";
import { assertNativeBox, assertNativeCoordinates, IDENTITY, multiply, nativePath, orthogonalBox, transform, type Box, type Matrix } from "./svg-pptx-geometry.ts";
import { PptxExportError, type PptxExportWarning } from "./export-types.ts";

export interface SvgConversionStats {
  warnings: PptxExportWarning[];
  nativeTextCount: number;
  nativeShapeCount: number;
  nativeImageCount: number;
}
interface Context { style: SvgStyle; matrix: Matrix }
const SKIP = new Set(["defs","style","title","desc","metadata","linearGradient","radialGradient","filter","clipPath","mask","pattern","marker","symbol"]);
const SHAPES = new Set(["rect","circle","ellipse","line","path","polygon","polyline"]);

export function addEditableSvg(slide: pptxgen.Slide, root: SvgElement, slideNumber: number): SvgConversionStats {
  const stats: SvgConversionStats = {warnings:[],nativeTextCount:0,nativeShapeCount:0,nativeImageCount:0};
  const css=styleResolver(root);
  let serial=0;
  const objectName=(element:SvgElement,kind:string)=>`${kind}: ${attr(element,"data-pptx-role") || attr(element,"id") || tag(element)} ${++serial}`;

  const fallback=(element:SvgElement,reason:string) => {
    let raster: ReturnType<typeof rasterElement>;
    try { raster=rasterElement(root,element); }
    catch(error) {
      if(error instanceof PptxExportError) throw error;
      throw new PptxExportError(`第 ${slideNumber} 页复杂元素无法渲染，请重新生成该页或选择高保真 PPTX`,"EXPORT_FAILED");
    }
    if(raster) slide.addImage({data:raster.data,...position(raster.box),objectName:objectName(element,"Raster fallback"),altText:"复杂 SVG 元素的保真图片"});
    stats.warnings.push({slide:slideNumber,element:attr(element,"id") || tag(element),reason});
  };

  const visit=(element:SvgElement,parent:Context) => {
    const name=tag(element);
    if(SKIP.has(name)) return;
    let style:SvgStyle;
    try {style=css.resolve(element,parent.style);style["text-decoration"]=combineDecorations(parent.style["text-decoration"],style["text-decoration"]);}
    catch {fallback(element,"不支持的样式值");return;}
    if(css.needsRaster(element)) {fallback(element,"复杂 CSS 选择器");return;}
    if(style.display === "none") return;
    // Visibility is inherited and a descendant may explicitly restore it.
    if(!["g","a","svg","text"].includes(name) && ["hidden","collapse"].includes(style.visibility)) return;
    let matrix:Matrix;
    try {
      if(opacity(style.opacity) === 0) return;
      matrix=multiply(parent.matrix,transform(attr(element,"transform")));
    }
    catch { fallback(element,"变换无法转换为原生对象"); return; }
    if(["font","x","y","width","height","cx","cy","r","rx","ry","d"].some(key=>style[key] && !(name==="rect" && ["rx","ry"].includes(key)))) {fallback(element,"CSS 简写或几何属性");return;}
    if(style.transform || (style["mix-blend-mode"] && style["mix-blend-mode"]!=="normal")) {fallback(element,"CSS 变换或混合效果");return;}
    if((style.filter && style.filter!=="none") || (style.mask && style.mask!=="none")) {fallback(element,"滤镜或蒙版");return;}
    if(Object.keys(style).some(key=>key.startsWith("text-decoration-") && style[key]) || Array.from(element.attributes).some(attribute=>attribute.name.startsWith("text-decoration-"))) {fallback(element,"自定义文本装饰");return;}
    if(name === "g" || name === "a" || name === "svg") {
      if((name === "svg" && element!==root) || (style["clip-path"] && style["clip-path"]!=="none") || opacity(style.opacity)<1) {
        fallback(element,"嵌套画布、分组裁切或分组透明度"); return;
      }
      children(element).forEach(child=>visit(child,{style,matrix})); return;
    }
    try {
      if(name !== "image" && style["clip-path"] && style["clip-path"]!=="none") throw new Error("元素裁切");
      if(name === "text") {
        const runs=textRuns(element,style,css.resolve);
        // Prepare everything before mutating the slide, so a failing run cannot leave duplicates.
        const texts=runs.map(run=>nativeText(run,matrix));
        for(const text of texts) { slide.addText(text.text,{...text.options,objectName:objectName(element,"Text")}); stats.nativeTextCount++; }
      } else if(name === "image") {
        const image=nativeImage(element,style,matrix,root);
        if(image) {slide.addImage({...image,objectName:objectName(element,"Image")});stats.nativeImageCount++;}
      } else if(SHAPES.has(name)) {
        const shape=nativeShape(element,style,matrix,root);
        // 4.0.1 documents points and implements custGeom, but omits it from its TS enum.
        if(shape) {slide.addShape("custGeom" as pptxgen.ShapeType,{...shape,objectName:objectName(element,"Shape")});stats.nativeShapeCount++;}
      } else throw new Error(`SVG ${name} 元素`);
    } catch(error) {
      if(error instanceof PptxExportError) throw error;
      fallback(element,error instanceof Error?error.message:"原生转换不支持");
    }
  };

  if(css.complexCss) {
    // Conservatively keep advanced selectors intact. Simple legacy classes remain fully native.
    fallback(root,"复杂 CSS 选择器或规则");
  } else visit(root,{style:{},matrix:IDENTITY});
  return stats;
}

function position(box:Box) {assertNativeBox(box);return {x:box.x/96,y:box.y/96,w:box.width/96,h:box.height/96};}
function val(element:SvgElement,name:string,fallback=0,relative=1280) {return length(attr(element,name),fallback,relative);}

function nativeShape(element:SvgElement,style:SvgStyle,matrix:Matrix,root:SvgElement): pptxgen.ShapeProps | null {
  if(style["fill-rule"] === "evenodd") throw new Error("奇偶填充规则");
  if(style["vector-effect"] && style["vector-effect"]!=="none") throw new Error("非缩放描边");
  if(style["paint-order"] && style["paint-order"]!=="normal") throw new Error("自定义绘制顺序");
  if(style["marker-mid"] && style["marker-mid"]!=="none") throw new Error("中间路径标记");
  const fill=color(style.fill,tag(element)==="line"?"none":"000000",style.color);
  const stroke=color(style.stroke,"none",style.color);
  if(stroke && ((style["stroke-linecap"] && style["stroke-linecap"]!=="butt") || (style["stroke-linejoin"] && style["stroke-linejoin"]!=="miter") || (style["stroke-dashoffset"] && length(style["stroke-dashoffset"])!==0) || (style["stroke-miterlimit"] && Number(style["stroke-miterlimit"])!==4))) throw new Error("自定义描边端点、连接或偏移");
  if(!fill && !stroke) return null;
  // Resolve SVG2 rectangle corner radii from the CSS cascade without mutating
  // the source tree needed by later local raster fallbacks.
  let geometry=element;
  if(tag(element)==="rect" && (style.rx || style.ry)) {
    geometry=element.cloneNode(false) as SvgElement;
    for(const key of ["rx","ry"]) if(style[key]) geometry.setAttribute(key,style[key]);
  }
  const d=shapePath(geometry);
  if(!d) return null;
  const path=nativePath(d,matrix);
  const scaleX=Math.hypot(matrix[0],matrix[1]),scaleY=Math.hypot(matrix[2],matrix[3]);
  if(stroke && Math.abs(scaleX-scaleY)>Math.max(scaleX,scaleY)*0.01) throw new Error("非等比变换的描边");
  const alpha=opacity(style.opacity);
  const dash=style["stroke-dasharray"];
  const strokeWidth=stroke?length(style["stroke-width"],1)*scaleX*0.75:0;
  if(!Number.isFinite(strokeWidth) || strokeWidth<0 || strokeWidth>384) throw new Error("描边宽度超出原生对象安全范围");
  const line:pptxgen.ShapeLineProps=stroke?{
    color:stroke.color,
    width:strokeWidth,
    transparency:strokeWidth===0?100:(1-stroke.alpha*alpha*opacity(style["stroke-opacity"]))*100,
    beginArrowType:arrowType(style["marker-start"],root),
    endArrowType:arrowType(style["marker-end"],root),
  }:{color:"000000",transparency:100,width:0};
  if(dash && dash!=="none") {
    const parts=dash.split(/[\s,]+/).map(Number);
    if(parts.length>2 || parts.some(v=>!Number.isFinite(v))) throw new Error("自定义虚线模式");
    line.dashType=parts[0]<=2?"sysDot":"dash";
  }
  return {...position(path.box),points:path.points,line,fill:fill?{color:fill.color,transparency:(1-fill.alpha*alpha*opacity(style["fill-opacity"]))*100}:{color:"FFFFFF",transparency:100}};
}

function arrowType(value:string|undefined,root:SvgElement): pptxgen.ShapeLineProps["endArrowType"] {
  if(!value || value==="none") return undefined;
  const id=value.match(/^url\(['"]?#([^'")]+)['"]?\)$/)?.[1];
  const marker=id?Array.from(root.getElementsByTagName("marker")).find(e=>attr(e,"id")===id):null;
  if(marker && children(marker).length===1 && ["path","polygon"].includes(tag(children(marker)[0]))) {
    // Only canonical triangular markers qualify; custom marks must be rasterized.
    const child=children(marker)[0];
    const path=shapePath(child);
    if((path.match(/[Ll]/g)?.length||0)===2 && /[zZ]\s*$/.test(path)) return "triangle";
  }
  throw new Error("自定义箭头标记");
}

function shapePath(e:SvgElement):string {
  const name=tag(e);
  if(name==="path") return attr(e,"d");
  if(name==="line") return `M ${val(e,"x1")} ${val(e,"y1",0,720)} L ${val(e,"x2")} ${val(e,"y2",0,720)}`;
  if(name==="polygon" || name==="polyline") {
    const raw=attr(e,"points").trim();
    const nums=raw.split(/[\s,]+/).map(Number);
    if(!nums.length || nums.length%2 || nums.some(v=>!Number.isFinite(v))) throw new Error("多边形坐标无效");
    return nums.map((v,i)=>i%2?`${v}`:`${i===0?"M":"L"} ${v}`).join(" ")+(name==="polygon"?" Z":"");
  }
  if(name==="rect") {
    const x=val(e,"x"),y=val(e,"y",0,720),w=val(e,"width"),h=val(e,"height",0,720);
    if(w<=0 || h<=0) return "";
    const rx=Math.min(w/2,Math.max(0,val(e,"rx",val(e,"ry")))),ry=Math.min(h/2,Math.max(0,val(e,"ry",rx)));
    if(!rx || !ry) return `M ${x} ${y} L ${x+w} ${y} L ${x+w} ${y+h} L ${x} ${y+h} Z`;
    return `M ${x+rx} ${y} L ${x+w-rx} ${y} A ${rx} ${ry} 0 0 1 ${x+w} ${y+ry} L ${x+w} ${y+h-ry} A ${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h} L ${x+rx} ${y+h} A ${rx} ${ry} 0 0 1 ${x} ${y+h-ry} L ${x} ${y+ry} A ${rx} ${ry} 0 0 1 ${x+rx} ${y} Z`;
  }
  const cx=val(e,"cx"),cy=val(e,"cy",0,720),rx=val(e,name==="circle"?"r":"rx"),ry=name==="circle"?rx:val(e,"ry",0,720);
  if(rx<=0 || ry<=0) return "";
  return `M ${cx-rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx+rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx-rx} ${cy} Z`;
}

interface TextRun {text:string;x:number;y:number;style:SvgStyle}
function textRuns(element:SvgElement,style:SvgStyle,resolve:(e:SvgElement,p?:SvgStyle)=>SvgStyle):TextRun[] {
  if(opacity(style.opacity)<1 && children(element).length) throw new Error("分段文字整体透明度");
  const runs:TextRun[]=[];
  let x=val(element,"x"),y=val(element,"y",0,720);
  const walk=(node:SvgNode,currentStyle:SvgStyle) => {
    if(node.nodeType===3 || node.nodeType===4) {
      const text=(node.nodeValue||"").replace(/\s+/g," ");
      if(!text.trim()) return;
      assertNativeTextStyle(currentStyle);
      runs.push({text,x,y,style:currentStyle});
      x+=measureText(text,currentStyle).width;
      return;
    }
    if(node.nodeType!==1) return;
    const e=node as SvgElement;
    if(!["text","tspan"].includes(tag(e))) throw new Error("沿路径或复杂文本");
    if(e!==element && attr(e,"transform")) throw new Error("文本分段变换");
    for(const key of ["rotate","textLength","lengthAdjust"]) if(attr(e,key)) throw new Error("逐字旋转或文本拉伸");
    const s=e===element?currentStyle:resolve(e,currentStyle);
    s["text-decoration"]=combineDecorations(currentStyle["text-decoration"],s["text-decoration"]);
    if(Array.from(e.attributes).some(attribute=>attribute.name.startsWith("text-decoration-"))) throw new Error("自定义文本装饰");
    if(s.display==="none") return;
    if(s.visibility==="hidden" || s.visibility==="collapse") throw new Error("局部文本可见性");
    if(e!==element && ["filter","mask","clip-path","transform","opacity"].some(key=>s[key] && s[key]!=="none")) throw new Error("文本分段效果");
    if(e!==element && attr(e,"x")) x=val(e,"x");
    if(e!==element && attr(e,"y")) y=val(e,"y",0,720);
    const font=length(s["font-size"],16);
    x+=length(attr(e,"dx"),0,1280,font); y+=length(attr(e,"dy"),0,720,font);
    Array.from(e.childNodes).forEach(child=>walk(child,s));
  };
  walk(element,style);
  // DrawingML runs do not share the SVG shaping/anchor model. Preserve mixed inline
  // styling locally instead of silently shifting words or dropping whitespace.
  const baselines=new Set<number>();
  for(const run of runs) {
    if(baselines.has(run.y)) throw new Error("同一行混合文本分段");
    baselines.add(run.y);
  }
  return runs;
}

// Native preparation and emission measure the same line. Keep only plain boxes,
// bounded within the one-job child, without retaining native renderer objects.
const textMeasurements=new Map<string,Box>();
function measureText(text:string,style:SvgStyle):Box {
  const size=length(style["font-size"],16);
  if(size<=0 || size>4096) throw new Error("字号超出原生测量安全范围");
  const family=fontFamily(style["font-family"],text);
  const escape=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><text x="0" y="100" font-family="${escape(family)}" font-size="${size}" font-weight="${escape(style["font-weight"]||"normal")}" font-style="${escape(style["font-style"]||"normal")}">${escape(text)}</text></svg>`;
  const cached=textMeasurements.get(svg);
  if(cached) return cached;
  const bbox=measureSvgTextBounds(svg);
  if(!bbox) throw new Error("字体无法测量");
  const box={x:bbox.x,y:bbox.y,width:bbox.width,height:bbox.height};
  if(textMeasurements.size>=512) textMeasurements.delete(textMeasurements.keys().next().value!);
  if(svg.length<=8192) textMeasurements.set(svg,box);
  return box;
}

function assertNativeTextStyle(s:SvgStyle):void {
  if(s["writing-mode"] && !["horizontal-tb","lr","lr-tb"].includes(s["writing-mode"])) throw new Error("竖排文本");
  if((s.stroke && s.stroke!=="none") || [s["clip-path"],s.mask,s.filter].some(v=>v && v!=="none")) throw new Error("文本描边或复杂效果");
  if(s["letter-spacing"] && !["normal","0","0px"].includes(s["letter-spacing"])) throw new Error("自定义字距");
  if(["word-spacing","font-variant","font-stretch"].some(key=>s[key] && !["normal","0","0px"].includes(s[key]))) throw new Error("特殊字体排版");
}

function nativeText(run:TextRun,matrix:Matrix):{text:string;options:pptxgen.TextPropsOptions} {
  const s=run.style;
  assertNativeTextStyle(s);
  const fill=color(s.fill,"000000",s.color);
  if(!fill) throw new Error("无填充文本");
  const size=length(s["font-size"],16);
  const fontSize=size*Math.hypot(matrix[2],matrix[3])*0.75;
  if(!Number.isFinite(fontSize) || fontSize<1 || fontSize>400) throw new Error("变换后字号超出原生对象安全范围");
  const decoration=textDecoration(s);
  const bbox=measureText(run.text,s);
  const width=Math.max(size*0.5,bbox.width+size*0.14);
  const anchor=s["text-anchor"]||"start";
  const x=run.x-(anchor==="middle"?width/2:anchor==="end"?width:0);
  const baseline=s["dominant-baseline"]||s["alignment-baseline"]||"auto";
  let y=run.y-size*0.84;
  if(["middle","central"].includes(baseline)) y=run.y-size*0.6;
  else if(["hanging","text-before-edge","before-edge"].includes(baseline)) y=run.y;
  else if(!["auto","alphabetic","baseline"].includes(baseline)) throw new Error("文本基线不支持");
  const box=orthogonalBox({x,y,width,height:size*1.24},matrix);
  if(!box || box.flipV || Math.abs(Math.hypot(matrix[0],matrix[1])-box.scale)>box.scale*0.01) throw new Error("倾斜或非等比文本变换");
  const weight=s["font-weight"]||"normal";
  return {text:run.text,options:{...position(box),rotate:box.rotate,fontSize,fontFace:fontFamily(s["font-family"],run.text),bold:/bold/i.test(weight)||Number(weight)>=600,italic:s["font-style"]==="italic"||s["font-style"]==="oblique",color:fill.color,transparency:(1-fill.alpha*opacity(s.opacity)*opacity(s["fill-opacity"]))*100,margin:0,breakLine:false,wrap:false,fit:"none",valign:"top",lang:/[\u2e80-\u9fff]/.test(run.text)?"zh-CN":"en-US",paraSpaceAfter:0,paraSpaceBefore:0,...decoration}};
}

function textDecoration(style:SvgStyle):Pick<pptxgen.TextPropsOptions,"underline"|"strike"> {
  const tokens=(style["text-decoration"] || "none").trim().split(/\s+/);
  if(tokens.some(token=>!["none","underline","line-through"].includes(token)) || (tokens.includes("none") && tokens.length>1)) throw new Error("复杂文本装饰");
  // CSS longhands have independent color/style/thickness semantics. Do not
  // silently flatten those into the one simple DrawingML underline we support.
  if(Object.keys(style).some(key=>key.startsWith("text-decoration-") && style[key])) throw new Error("自定义文本装饰");
  return {underline:tokens.includes("underline")?{style:"sng"}:undefined,strike:tokens.includes("line-through")?"sngStrike":undefined};
}

function combineDecorations(parent:string|undefined,current:string|undefined):string {
  // Decorations propagate from ancestors: a descendant's `none` does not erase
  // an ancestor's underline, and its own line-through adds to that underline.
  return [...new Set(`${parent || ""} ${current || ""}`.trim().split(/\s+/).filter(token=>token && token!=="none"))].join(" ") || "none";
}

function nativeImage(element:SvgElement,style:SvgStyle,matrix:Matrix,root:SvgElement):pptxgen.ImageProps|null {
  let data=attr(element,"href") || attr(element,"xlink:href");
  const bytes=Buffer.from(data.slice(data.indexOf(",")+1),"base64");
  let dimensions:{width?:number;height?:number};
  try {dimensions=imageSize(bytes);} catch {throw new Error("图片格式需要栅格化");}
  if(!dimensions.width || !dimensions.height || dimensions.width*dimensions.height>32_000_000) throw new PptxExportError("图片尺寸超过导出上限（3200 万像素）","SVG_LIMIT");
  const viewport={x:val(element,"x"),y:val(element,"y",0,720),width:val(element,"width"),height:val(element,"height",0,720)};
  if(viewport.width<=0 || viewport.height<=0) return null;
  if(!/^data:image\/(?:png|jpeg|jpg);base64,/i.test(data)) {
    // Preserve non-Office formats as ordinary PNG pictures, keeping them replaceable.
    const standalone=`<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}"><image width="100%" height="100%" href="${data}"/></svg>`;
    data=`data:image/png;base64,${svgRenderer(standalone,Math.min(2560,dimensions.width)).render().asPng().toString("base64")}`;
  }
  const par=(attr(element,"preserveAspectRatio")||"xMidYMid meet").trim();
  if(!/^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(par)) throw new Error("图片比例模式");
  let image={...viewport};
  if(par!=="none") {
    const scale=par.includes("slice")?Math.max(viewport.width/dimensions.width,viewport.height/dimensions.height):Math.min(viewport.width/dimensions.width,viewport.height/dimensions.height);
    image.width=dimensions.width*scale;image.height=dimensions.height*scale;
    image.x+= (viewport.width-image.width)*(par.startsWith("xMin")?0:par.startsWith("xMax")?1:0.5);
    image.y+= (viewport.height-image.height)*(par.includes("YMin")?0:par.includes("YMax")?1:0.5);
  }
  let visible=intersection(image,viewport);
  const clip=style["clip-path"];
  if(clip && clip!=="none") {
    const id=clip.match(/^url\(['"]?#([^'")]+)['"]?\)$/)?.[1];
    const clipPath=Array.from(root.getElementsByTagName("clipPath")).find(e=>attr(e,"id")===id);
    const rect=clipPath?children(clipPath)[0]:null;
    if(!clipPath || children(clipPath).length!==1 || !rect || tag(rect)!=="rect" || attr(rect,"rx") || attr(rect,"ry") || attr(rect,"transform") || attr(clipPath,"transform")) throw new Error("非矩形图片裁切");
    const unit=attr(clipPath,"clipPathUnits");
    if(unit && !["userSpaceOnUse","objectBoundingBox"].includes(unit)) throw new Error("图片裁切坐标系不支持");
    // Percentages in objectBoundingBox units are fractions of the image's
    // object box, not percentages of the slide followed by a second scaling.
    const relativeX=unit==="objectBoundingBox"?1:1280,relativeY=unit==="objectBoundingBox"?1:720;
    let box={x:val(rect,"x",0,relativeX),y:val(rect,"y",0,relativeY),width:val(rect,"width",0,relativeX),height:val(rect,"height",0,relativeY)};
    if(unit==="objectBoundingBox") box={x:viewport.x+box.x*viewport.width,y:viewport.y+box.y*viewport.height,width:box.width*viewport.width,height:box.height*viewport.height};
    visible=intersection(visible,box);
  }
  if(visible.width<=0 || visible.height<=0) return null;
  const box=orthogonalBox(visible,matrix);
  if(!box) throw new Error("倾斜图片");
  assertNativeBox(box);
  const crop={left:(visible.x-image.x)/image.width,top:(visible.y-image.y)/image.height,width:visible.width/image.width,height:visible.height/image.height};
  // Intersections can produce 1 + machine epsilon for an entirely visible
  // image. Normalize rounding only; real out-of-bounds crops still fall back.
  if(Object.values(crop).some(value=>!Number.isFinite(value) || value < -1e-9 || value > 1+1e-9)) throw new Error("图片裁切比例无效");
  for(const key of ["left","top","width","height"] as const) crop[key]=Math.min(1,Math.max(0,crop[key]));
  // PptxGenJS crop uses the supplied pre-crop size; it writes standard a:srcRect.
  const uncroppedW=box.width/crop.width,uncroppedH=box.height/crop.height;
  assertNativeCoordinates(uncroppedW,uncroppedH,crop.left*uncroppedW,crop.top*uncroppedH);
  return {data,x:box.x/96,y:box.y/96,w:uncroppedW/96,h:uncroppedH/96,rotate:box.rotate,flipV:box.flipV,transparency:(1-opacity(style.opacity))*100,sizing:{type:"crop",x:crop.left*uncroppedW/96,y:crop.top*uncroppedH/96,w:box.width/96,h:box.height/96},altText:attr(element,"aria-label")||attr(element,"data-pptx-role")||"嵌入图片"};
}

function intersection(a:Box,b:Box):Box {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}
