import { attr, children, tag, type SvgElement } from "./svg-pptx-document.ts";
import fs from "node:fs";

export const DEFAULT_CJK_FONT = process.platform === "darwin" && fs.existsSync("/System/Library/Fonts/Hiragino Sans GB.ttc")
  ? "Hiragino Sans GB" : process.platform === "win32" ? "Microsoft YaHei" : "Noto Sans CJK SC";

export type SvgStyle = Record<string,string>;
const INHERITED = new Set(["fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","stroke-dashoffset","stroke-miterlimit","color","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","alignment-baseline","letter-spacing","word-spacing","font-variant","font-stretch","writing-mode","visibility","text-decoration","marker-start","marker-mid","marker-end"]);
const PROPERTIES=[...INHERITED,"opacity","display","filter","clip-path","mask","mix-blend-mode","vector-effect","paint-order","writing-mode","textLength","lengthAdjust"];
interface Rule { selector: string; declarations: SvgStyle; specificity: number }

export function declarations(value: string): SvgStyle {
  return Object.fromEntries(value.split(";").map(v=>v.split(/:([\s\S]*)/).slice(0,2).map(s=>s.trim())).filter(v=>v.length===2 && v[0]));
}

export function styleResolver(root: SvgElement) {
  const rules: Rule[]=[];
  let complexCss=false;
  const complexSelectors:string[]=[];
  for(const style of Array.from(root.getElementsByTagName("style"))) {
    const css=(style.textContent || "").replace(/\/\*[\s\S]*?\*\//g,"");
    if(/@/.test(css)) complexCss=true;
    for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for(const selector of match[1].split(",").map(v=>v.trim())) {
        // Structural dependencies may live on ancestors, e.g. .a + .b rect.
        // Keep the complete page for these rules until computed-style freezing
        // is supported. Isolating any subtree could silently change the result.
        if(/[+~]|:(?:nth|first|last|only|has)/i.test(selector)) complexCss=true;
        if(/!important/i.test(match[2]) || !/^[\w.*#\s>-]+$/.test(selector)) { complexSelectors.push(selector); continue; }
        rules.push({selector,declarations:declarations(match[2]),specificity:(selector.match(/#/g)?.length||0)*100+(selector.match(/\./g)?.length||0)*10+(selector.match(/(?:^|\s)[a-z]/gi)?.length||0)});
      }
    }
  }
  rules.sort((a,b)=>a.specificity-b.specificity);
  return {
    complexCss,
    needsRaster(element:SvgElement):boolean {
      // Unsupported selector syntax only affects possible subjects of that rule.
      // Its rightmost type/class/id safely overestimates the target set; Resvg
      // resolves the full original selector when rendering the isolated element.
      return complexSelectors.some(selector=>{
        const subject=selector.trim().split(/[\s>+~]+/).pop() || "*";
        const base=subject.match(/^(?:[\w*-]+)?(?:[.#][\w-]+)*/)?.[0] || "*";
        // Structural selectors depend on siblings; retain that parent subtree
        // intact so isolation does not alter nth-of-type or sibling matching.
        if(/[+~]|:(?:nth|first|last|only|has)/i.test(selector)) return children(element).some(child=>simple(child,base));
        return simple(element,base);
      });
    },
    resolve(element: SvgElement,parent: SvgStyle = {}): SvgStyle {
      const result: SvgStyle={};
      for(const [key,value] of Object.entries(parent)) if(INHERITED.has(key)) result[key]=value;
      for(const key of PROPERTIES) if(element.hasAttribute(key)) result[key]=attr(element,key);
      for(const rule of rules) if(matches(element,rule.selector)) Object.assign(result,rule.declarations);
      Object.assign(result,declarations(attr(element,"style")));
      for(const [key,value] of Object.entries(result)) {
        if(value === "inherit") result[key]=parent[key] || "";
        if(/!important/.test(value)) result[key]=value.replace(/\s*!important\s*$/,"");
      }
      if(result["font-size"]) result["font-size"]=String(length(result["font-size"],16,length(parent["font-size"],16),length(parent["font-size"],16)));
      return result;
    },
  };
}

function matches(element: SvgElement,selector: string): boolean {
  const parts=selector.trim().replace(/\s*>\s*/g," > ").split(/\s+/).reverse();
  if(!simple(element,parts[0])) return false;
  let parent=element.parentNode;
  for(let i=1;i<parts.length;i++) {
    const direct=parts[i]===">";
    const part=direct?parts[++i]:parts[i];
    if(!part) return false;
    if(direct) {
      if(!parent || parent.nodeType!==1 || !simple(parent as SvgElement,part)) return false;
    } else {
      while(parent && !(parent.nodeType===1 && simple(parent as SvgElement,part))) parent=parent.parentNode;
      if(!parent) return false;
    }
    parent=parent.parentNode;
  }
  return true;
}

function simple(element: SvgElement,selector: string): boolean {
  const type=selector.match(/^[\w*-]+/)?.[0];
  if(type && type!=="*" && tag(element)!==type) return false;
  for(const match of selector.matchAll(/([.#])([\w-]+)/g)) {
    if(match[1]==="#" ? attr(element,"id")!==match[2] : !attr(element,"class").split(/\s+/).includes(match[2])) return false;
  }
  return true;
}

/** CSS lengths in the fixed 1280 × 720 coordinate system. */
export function length(value: string | undefined, fallback=0, relative=1280, fontSize=16): number {
  if(!value) return fallback;
  const match=value.trim().match(/^([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)(px|pt|pc|in|cm|mm|em|rem|%)?$/i);
  if(!match) throw new Error("长度单位不支持");
  const n=Number(match[1]);
  const unit=match[2]?.toLowerCase() || "px";
  const scale: Record<string,number>={px:1,pt:96/72,pc:16,in:96,cm:96/2.54,mm:96/25.4,em:fontSize,rem:16,"%":relative/100};
  const result=n*scale[unit];
  if(!Number.isFinite(result) || Math.abs(result)>1_000_000) throw new Error("长度超限");
  return result;
}

export function color(value: string | undefined, fallback="000000", current="000000"): { color: string; alpha: number } | null {
  const v=(value || fallback).trim().toLowerCase();
  if(v==="none" || v==="transparent") return null;
  if(v==="currentcolor") return color(current,fallback);
  const names: Record<string,string>={black:"000000",white:"FFFFFF",red:"FF0000",green:"008000",blue:"0000FF",gray:"808080",grey:"808080",silver:"C0C0C0",yellow:"FFFF00",orange:"FFA500",purple:"800080",navy:"000080",teal:"008080",aqua:"00FFFF",cyan:"00FFFF",fuchsia:"FF00FF",magenta:"FF00FF",lime:"00FF00",maroon:"800000",olive:"808000",rebeccapurple:"663399",whitesmoke:"F5F5F5",lightgray:"D3D3D3",darkgray:"A9A9A9"};
  if(names[v]) return {color:names[v],alpha:1};
  const hex=v.replace(/^#/,"");
  if(/^[\da-f]{3,4}$/.test(hex)) return color(`#${[...hex].map(c=>c+c).join("")}`);
  if(/^[\da-f]{6}([\da-f]{2})?$/.test(hex)) return {color:hex.slice(0,6).toUpperCase(),alpha:hex.length===8?parseInt(hex.slice(6),16)/255:1};
  const rgb=v.match(/^rgba?\(\s*([\d.%]+)[,\s]+([\d.%]+)[,\s]+([\d.%]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/);
  if(rgb) {
    const channel=(s:string)=>Math.max(0,Math.min(255,Math.round(parseFloat(s)*(s.endsWith("%")?2.55:1)))).toString(16).padStart(2,"0");
    return {color:rgb.slice(1,4).map(channel).join("").toUpperCase(),alpha:rgb[4]?opacity(rgb[4]):1};
  }
  throw new Error("颜色或渐变需要保真降级");
}

export function opacity(value: string | undefined): number {
  if(!value) return 1;
  const parsed=parseFloat(value)/(value.endsWith("%")?100:1);
  if(!Number.isFinite(parsed)) throw new Error("透明度无效");
  return Math.max(0,Math.min(1,parsed));
}

export function fontFamily(value: string | undefined, text: string): string {
  const families=(value||"").split(",").map(v=>v.trim().replace(/^['"]|['"]$/g,"")).filter(Boolean);
  const generic=new Set(["sans-serif","serif","monospace","system-ui","ui-sans-serif"]);
  const first=families.find(v=>!generic.has(v) && !/^(?:-apple-system|BlinkMacSystemFont)$/i.test(v));
  if(/[\u2e80-\u9fff\uf900-\ufaff]/.test(text)) {
    if(first && /^(?:Microsoft YaHei|微软雅黑|PingFang SC|Hiragino Sans GB|Noto Sans SC|Noto Sans CJK SC)$/.test(first)) return DEFAULT_CJK_FONT;
    if(first && !/Arial|Helvetica|Calibri|Aptos|Times|Inter|Segoe UI/i.test(first)) return first;
    return DEFAULT_CJK_FONT;
  }
  return first || "Arial";
}
