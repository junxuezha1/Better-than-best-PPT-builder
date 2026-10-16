import svgpath from "svgpath";
import type pptxgen from "pptxgenjs";

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const PX_PER_INCH = 96;
export interface Box { x: number; y: number; width: number; height: number }

// PptxGenJS treats positive numeric values >= 100 as EMU rather than inches.
// Keeping native geometry under 100 inches avoids that unit ambiguity and is
// comfortably within DrawingML's integer ranges. Larger art is rasterized.
export const MAX_NATIVE_PX = 8192;
export function assertNativeCoordinates(...values: number[]): void {
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_NATIVE_PX)) throw new Error("变换后坐标超出原生对象安全范围");
}
export function assertNativeBox(box: Box): void {
  assertNativeCoordinates(box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height);
  if (box.width < 0.001 || box.height < 0.001) throw new Error("原生对象尺寸过小");
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

export function point(m: Matrix, x: number, y: number) {
  return { x: m[0]*x+m[2]*y+m[4], y: m[1]*x+m[3]*y+m[5] };
}

export function transform(value: string): Matrix {
  let result = IDENTITY;
  let rest = value;
  for (const match of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    rest = rest.replace(match[0], "");
    const v = match[2].trim().split(/[\s,]+/).map(Number);
    if (!v.every(Number.isFinite)) throw new Error("变换参数无效");
    let next: Matrix;
    const angle = (v[0] || 0)*Math.PI/180;
    switch (match[1]) {
      case "matrix": if(v.length !== 6) throw new Error("矩阵参数无效"); next = v as Matrix; break;
      case "translate": next = [1,0,0,1,v[0],v[1] || 0]; break;
      case "scale": next = [v[0],0,0,v[1] ?? v[0],0,0]; break;
      case "rotate": {
        next = [Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0];
        if(v.length === 3) next = multiply(multiply([1,0,0,1,v[1],v[2]],next),[1,0,0,1,-v[1],-v[2]]);
        break;
      }
      case "skewX": next = [1,0,Math.tan(angle),1,0,0]; break;
      case "skewY": next = [1,Math.tan(angle),0,1,0,0]; break;
      default: throw new Error("不支持的变换");
    }
    result = multiply(result,next);
  }
  if(rest.replace(/[\s,]/g, "") || !result.every(Number.isFinite)) throw new Error("变换参数无效");
  return result;
}

/** A rotated rectangle can be represented by native text/picture rotation; shear cannot. */
export function orthogonalBox(box: Box, m: Matrix): (Box & { rotate: number; flipH: boolean; flipV: boolean; scale: number }) | null {
  const sx = Math.hypot(m[0],m[1]);
  const sy = Math.hypot(m[2],m[3]);
  if (sx < 1e-8 || sy < 1e-8 || Math.abs(m[0]*m[2]+m[1]*m[3]) > sx*sy*1e-5) return null;
  const center = point(m,box.x+box.width/2,box.y+box.height/2);
  return { x:center.x-box.width*sx/2, y:center.y-box.height*sy/2, width:box.width*sx, height:box.height*sy, rotate:Math.atan2(m[1],m[0])*180/Math.PI, flipH:false, flipV:m[0]*m[3]-m[1]*m[2]<0, scale:sy };
}

/** SVG normalization comes from svgpath (MIT); PptxGenJS writes all DrawingML. */
export function nativePath(d: string, matrix: Matrix): { box: Box; points: NonNullable<pptxgen.ShapeProps["points"]> } {
  if (d.length > 150_000) throw new Error("路径过于复杂");
  const parsed = svgpath(d).abs().unshort().unarc().matrix(matrix);
  if ((parsed as unknown as { err: string }).err) throw new Error("路径无效");
  const segments: Array<Array<number | string>> = [];
  parsed.iterate((segment) => { segments.push([...segment]); });
  if (!segments.length || segments.length > 20_000) throw new Error("路径过于复杂或为空");
  let x = 0, y = 0, startX = 0, startY = 0;
  const xs: number[] = [], ys: number[] = [];
  for (const s of segments) {
    if(s[0] === "M") { startX=Number(s[1]); startY=Number(s[2]); }
    if(s[0] === "Z" || s[0] === "z") { x=startX; y=startY; continue; }
    if(s[0] === "H") { x = Number(s[1]); s.splice(0, s.length, "L", x, y); }
    else if(s[0] === "V") { y = Number(s[1]); s.splice(0, s.length, "L", x, y); }
    if(!/[zZ]/.test(String(s[0]))) {
      for(let i=1;i<s.length;i+=2) { xs.push(Number(s[i])); ys.push(Number(s[i+1])); }
      x = Number(s[s.length-2]); y = Number(s[s.length-1]);
    }
  }
  if (!xs.length) throw new Error("路径坐标无效");
  for(let i=0;i<xs.length;i++) assertNativeCoordinates(xs[i],ys[i]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const box = { x:minX, y:minY, width:Math.max(0.01,Math.max(...xs)-minX), height:Math.max(0.01,Math.max(...ys)-minY) };
  assertNativeBox(box);
  const xy = (a: number | string,b: number | string) => ({ x:(Number(a)-minX)/96, y:(Number(b)-minY)/96 });
  const points: NonNullable<pptxgen.ShapeProps["points"]> = segments.map(s => {
    if (s[0] === "Z" || s[0] === "z") return { close:true };
    if (s[0] === "M") return {...xy(s[1],s[2]),moveTo:true};
    if (s[0] === "L") return xy(s[1],s[2]);
    if (s[0] === "C") { const c1=xy(s[1],s[2]),c2=xy(s[3],s[4]); return {...xy(s[5],s[6]),curve:{type:"cubic",x1:c1.x,y1:c1.y,x2:c2.x,y2:c2.y}}; }
    if (s[0] === "Q") { const c=xy(s[1],s[2]); return {...xy(s[3],s[4]),curve:{type:"quadratic",x1:c.x,y1:c.y}}; }
    throw new Error("路径命令不支持");
  });
  return {box,points};
}
