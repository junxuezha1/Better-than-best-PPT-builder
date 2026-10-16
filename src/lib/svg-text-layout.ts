import { Resvg } from "@resvg/resvg-js";

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgTextOverflow {
  text: string;
  textBox: LayoutBox;
  containerBox: LayoutBox;
  overflow: { left: number; right: number; top: number; bottom: number };
}

interface MeasuredElement {
  box: LayoutBox;
}

interface TextCandidate {
  markup: string;
  ancestors: string[];
  anchor: { x: number; y: number };
  estimate: LayoutBox;
}

type Matrix = [number, number, number, number, number, number];

const BOUNDS_TOLERANCE = 5;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function findSvgTextOverflows(svg: string): SvgTextOverflow[] {
  const root = svg.match(/^<svg\b[^>]*>/i)?.[0];
  if (!root) return [];
  const defs = svg.match(/<defs\b[\s\S]*?<\/defs>/i)?.[0] ?? "";
  const stack: string[] = [];
  const matrices: Matrix[] = [IDENTITY];
  const rects: MeasuredElement[] = [];
  const texts: TextCandidate[] = [];
  const classFontSizes = cssClassFontSizes(defs);
  const tokens = svg.matchAll(/<g\b[^>]*>|<\/g\s*>|<rect\b[^>]*\/?\s*>|<text\b[^>]*>[\s\S]*?<\/text\s*>/gi);

  for (const match of tokens) {
    const markup = match[0];
    if (/^<g\b/i.test(markup)) {
      stack.push(markup);
      matrices.push(multiply(matrices[matrices.length - 1], transformMatrix(attribute(markup, "transform"))));
      continue;
    }
    if (/^<\/g/i.test(markup)) {
      stack.pop();
      if (matrices.length > 1) matrices.pop();
      continue;
    }
    if (/^<rect\b/i.test(markup)) {
      const box = rectBox(markup, matrices[matrices.length - 1]);
      if (box && box.width >= 48 && box.height >= 20) rects.push({ box });
      continue;
    }
    const candidate = textCandidate(markup, stack, matrices[matrices.length - 1], classFontSizes);
    if (candidate) texts.push(candidate);
  }

  return texts.flatMap((element) => {
    const container = rects
      .filter(({ box }) => containsPoint(box, element.anchor.x, element.anchor.y))
      .sort((a, b) => area(a.box) - area(b.box))[0];
    if (!container) return [];
    if (!nearContainerEdge(element.estimate, container.box)) return [];
    const box = measureElement(root, defs, element.ancestors, element.markup);
    if (!box) return [];
    const overflow = {
      left: container.box.x - box.x,
      right: box.x + box.width - (container.box.x + container.box.width),
      top: container.box.y - box.y,
      bottom: box.y + box.height - (container.box.y + container.box.height),
    };
    return Object.values(overflow).some((value) => value > BOUNDS_TOLERANCE)
      ? [{ text: visibleText(element.markup), textBox: box, containerBox: container.box, overflow }]
      : [];
  });
}

export function assertSvgTextFits(svg: string): void {
  const issues = findSvgTextOverflows(svg);
  if (!issues.length) return;
  const detail = issues.slice(0, 3).map((issue) => {
    const directions = [
      issue.overflow.left > BOUNDS_TOLERANCE ? `左侧 ${Math.ceil(issue.overflow.left)}px` : "",
      issue.overflow.right > BOUNDS_TOLERANCE ? `右侧 ${Math.ceil(issue.overflow.right)}px` : "",
      issue.overflow.top > BOUNDS_TOLERANCE ? `顶部 ${Math.ceil(issue.overflow.top)}px` : "",
      issue.overflow.bottom > BOUNDS_TOLERANCE ? `底部 ${Math.ceil(issue.overflow.bottom)}px` : "",
    ].filter(Boolean).join("、");
    return `“${issue.text.slice(0, 70)}”超出所在容器${directions}`;
  }).join("；");
  throw new Error(`SVG 文字出框：${detail}。请拆分为多行 tspan、增加容器空间或精简文案，不能缩小到 13px 以下。`);
}

function measureElement(root: string, defs: string, ancestors: string[], markup: string): LayoutBox | null {
  try {
    const document = `${root}${defs}${ancestors.join("")}${markup}${ancestors.map(() => "</g>").join("")}</svg>`;
    const bbox = new Resvg(document, { textRendering: 2 }).getBBox();
    return bbox ? { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height } : null;
  } catch {
    return null;
  }
}

function textCandidate(
  markup: string,
  ancestors: string[],
  matrix: Matrix,
  classFontSizes: Map<string, number>,
): TextCandidate | null {
  const text = visibleText(markup);
  if (!text) return null;
  const opening = markup.match(/^<text\b[^>]*>/i)?.[0] ?? "";
  const x = numberAttribute(opening, "x", 0);
  const y = numberAttribute(opening, "y", 0);
  const fontSize = textFontSize(opening, classFontSizes);
  const lines = [...markup.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/gi)]
    .map((match) => visibleText(match[1]))
    .filter(Boolean);
  const lineTexts = lines.length ? lines : [text];
  const width = Math.max(...lineTexts.map((line) => estimatedTextWidth(line, fontSize)));
  const height = fontSize * 1.25 * lineTexts.length;
  const anchorType = attribute(opening, "text-anchor")
    || styleProperty(opening, "text-anchor")
    || "start";
  const localX = anchorType === "middle" ? x - width / 2 : anchorType === "end" ? x - width : x;
  const elementMatrix = multiply(matrix, transformMatrix(attribute(opening, "transform")));
  const estimate = transformedBox({ x: localX, y: y - fontSize, width, height }, elementMatrix);
  const anchor = applyMatrix(elementMatrix, x, y - fontSize / 2);
  return { markup, ancestors: [...ancestors], anchor, estimate };
}

function rectBox(markup: string, parentMatrix: Matrix): LayoutBox | null {
  const width = numberAttribute(markup, "width", 0);
  const height = numberAttribute(markup, "height", 0);
  if (!(width > 0 && height > 0)) return null;
  const matrix = multiply(parentMatrix, transformMatrix(attribute(markup, "transform")));
  return transformedBox({
    x: numberAttribute(markup, "x", 0),
    y: numberAttribute(markup, "y", 0),
    width,
    height,
  }, matrix);
}

function transformedBox(box: LayoutBox, matrix: Matrix): LayoutBox {
  const points = [
    applyMatrix(matrix, box.x, box.y),
    applyMatrix(matrix, box.x + box.width, box.y),
    applyMatrix(matrix, box.x, box.y + box.height),
    applyMatrix(matrix, box.x + box.width, box.y + box.height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function transformMatrix(value: string): Matrix {
  let result: Matrix = IDENTITY;
  for (const match of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi)) {
    const values = match[2].trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    let next: Matrix = IDENTITY;
    if (match[1].toLowerCase() === "matrix" && values.length >= 6) {
      next = values.slice(0, 6) as Matrix;
    } else if (match[1].toLowerCase() === "translate") {
      next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (match[1].toLowerCase() === "scale") {
      next = [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0];
    } else if (match[1].toLowerCase() === "rotate") {
      const radians = (values[0] ?? 0) * Math.PI / 180;
      const rotation: Matrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
      if (values.length >= 3) {
        const [cx, cy] = values.slice(1);
        next = multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
      } else next = rotation;
    }
    result = multiply(result, next);
  }
  return result;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function cssClassFontSizes(defs: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const match of defs.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const size = Number(match[2].match(/font-size\s*:\s*([\d.]+)px/i)?.[1]);
    if (Number.isFinite(size) && size > 0) sizes.set(match[1], size);
  }
  return sizes;
}

function textFontSize(opening: string, classFontSizes: Map<string, number>): number {
  const direct = numberAttribute(opening, "font-size", 0) || Number(styleProperty(opening, "font-size").replace(/px$/i, ""));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const classes = attribute(opening, "class").split(/\s+/);
  return classes.map((name) => classFontSizes.get(name) ?? 0).find((size) => size > 0) ?? 16;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  return [...text].reduce((width, character) => {
    if (/\s/.test(character)) return width + fontSize * 0.32;
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(character)) return width + fontSize;
    return width + fontSize * 0.58;
  }, 0);
}

function nearContainerEdge(text: LayoutBox, container: LayoutBox): boolean {
  const margin = 18;
  return text.x < container.x + margin
    || text.x + text.width > container.x + container.width - margin
    || text.y < container.y + margin
    || text.y + text.height > container.y + container.height - margin;
}

function attribute(markup: string, name: string): string {
  return markup.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "";
}

function numberAttribute(markup: string, name: string, fallback: number): number {
  const value = Number(attribute(markup, name).replace(/px$/i, ""));
  return Number.isFinite(value) ? value : fallback;
}

function styleProperty(markup: string, name: string): string {
  const style = attribute(markup, "style");
  return style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"))?.[1]?.trim() ?? "";
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPoint(box: LayoutBox, x: number, y: number): boolean {
  return x >= box.x - BOUNDS_TOLERANCE
    && x <= box.x + box.width + BOUNDS_TOLERANCE
    && y >= box.y - BOUNDS_TOLERANCE
    && y <= box.y + box.height + BOUNDS_TOLERANCE;
}

function area(box: LayoutBox): number {
  return box.width * box.height;
}
