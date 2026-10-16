import pptxgen from "pptxgenjs";
import { parseSvg, serialize, svgRenderer, resetRenderBudget } from "./svg-pptx-document.ts";
import { addEditableSvg } from "./svg-pptx.ts";
import { DEFAULT_CJK_FONT } from "./svg-pptx-style.ts";
import { PptxExportError, parseExportMode } from "./export-types.ts";
import type { PptxExportMode, PptxExportResult, PptxSlideInput } from "./export-types.ts";

export interface PptxBuildOptions { mode?: PptxExportMode; title?: string }

/** The order of this array is the slide order. No file-name sorting or missing-page filtering. */
export async function buildPptxDetailed(
  inputs: Array<PptxSlideInput | string>,
  options: PptxBuildOptions = {},
): Promise<PptxExportResult> {
  resetRenderBudget();
  if(!inputs.length) throw new PptxExportError("没有可导出的设计稿", "INVALID_SVG");
  if(inputs.length>80) throw new PptxExportError("一次最多导出 80 页", "SVG_LIMIT");
  const mode=parseExportMode(options.mode);
  const slides=inputs.map(input=>typeof input === "string"?{svg:input}:input);
  if(slides.reduce((n,s)=>n+Buffer.byteLength(s.svg),0)>40*1024*1024) throw new PptxExportError("整份设计稿不能超过 40MB", "SVG_LIMIT");
  const pptx=new pptxgen();
  pptx.defineLayout({name:"SVG_16_9",width:1280/96,height:720/96});
  pptx.layout="SVG_16_9";
  pptx.title=cleanText(options.title||"PPT Agent");
  pptx.subject="SVG presentation";
  pptx.author="PPT Agent";
  pptx.company="";
  pptx.theme={headFontFace:DEFAULT_CJK_FONT,bodyFontFace:DEFAULT_CJK_FONT};
  const result:PptxExportResult={buffer:Buffer.alloc(0),warnings:[],nativeTextCount:0,nativeShapeCount:0,nativeImageCount:0};
  for(const [index,input] of slides.entries()) {
    try {
      const doc=parseSvg(input.svg);
      const root=doc.documentElement!;
      // Validate the complete layer before attempting any local conversion.
      svgRenderer(serialize(root),320).render();
      const slide=pptx.addSlide();
      slide.hidden = input.hidden === true;
      slide.background={color:"FFFFFF"};
      if(mode === "fidelity") {
        const image=svgRenderer(serialize(root),2560).render();
        slide.addImage({data:`data:image/png;base64,${image.asPng().toString("base64")}`,x:0,y:0,w:1280/96,h:720/96,objectName:"Full slide fidelity",altText:cleanText(input.title||`第 ${index+1} 页`)});
      } else {
        const stats=addEditableSvg(slide,root,index+1);
        result.warnings.push(...stats.warnings);
        result.nativeTextCount+=stats.nativeTextCount;
        result.nativeShapeCount+=stats.nativeShapeCount;
        result.nativeImageCount+=stats.nativeImageCount;
      }
      if(input.notes) slide.addNotes(cleanText(input.notes));
    } catch(error) {
      if(error instanceof PptxExportError) throw new PptxExportError(`第 ${index+1} 页：${error.message}`,error.code,error.status);
      throw new PptxExportError(`第 ${index+1} 页 SVG 无法渲染，请检查设计稿后重试`,"INVALID_SVG");
    }
  }
  try {result.buffer=Buffer.from(await pptx.write({outputType:"nodebuffer",compression:true}) as Buffer);}
  catch {throw new PptxExportError("PPTX 打包失败，请重试或选择高保真 PPTX", "EXPORT_FAILED",500);}
  if (result.buffer.byteLength > 128 * 1024 * 1024) throw new PptxExportError("PPTX 文件超过 128MB，请拆分文稿后重试", "RESOURCE_LIMIT");
  return result;
}

/** Retains the previous Buffer-returning API; new callers can consume conversion warnings. */
export async function buildPptx(inputs: Array<PptxSlideInput | string>,options:PptxBuildOptions={}):Promise<Buffer> {
  return (await buildPptxDetailed(inputs,options)).buffer;
}

function cleanText(value:string):string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,"");
}
