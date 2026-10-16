import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { getDesignTheme } from "./theme-catalog.ts";
import type { ThemeSelection } from "./theme-catalog.ts";

const NS = "http://www.w3.org/2000/svg";
const LAYER = "ppt-agent-theme-background";
const serializer = new XMLSerializer();
const children = (element: Element): Element[] => Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);

/** Only the managed layer and leading, full-canvas paint are changed. All
 * foreground text, paths, photographs, order and brand marks remain intact. */
export function composeThemeBackground(input: string, selection: ThemeSelection | null, background?: Buffer): string {
  if (!selection && !input.includes(LAYER)) return input;
  if (Buffer.byteLength(input) > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("页面 SVG 不合法");
  const doc = new DOMParser({ onError: () => { throw new Error("页面 SVG 无法解析"); } }).parseFromString(input, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg") throw new Error("页面 SVG 缺少根节点");
  for (const element of children(root)) if (element.getAttribute("id") === LAYER) root.removeChild(element);
  // Restore original full-canvas paint before reapplying or disabling the layer.
  const restore = (parent: Element) => {
    for (const element of children(parent)) {
      if (element.hasAttribute("data-theme-original-opacity")) {
        const original = element.getAttribute("data-theme-original-opacity") ?? "";
        if (original) element.setAttribute("opacity", original); else element.removeAttribute("opacity");
        element.removeAttribute("data-theme-original-opacity");
      }
      restore(element);
    }
  };
  restore(root);
  if (!selection) return serializer.serializeToString(doc);
  if (!background?.length) throw new Error("主题背景素材不可用");
  const theme = getDesignTheme(selection.themeId, selection.definition);
  const full = (e: Element) => {
    const extent = (name: string, expected: number) => e.getAttribute(name) === "100%" || Number(e.getAttribute(name)) === expected;
    return ["rect", "image"].includes(e.localName ?? "") && extent("width", 1280) && extent("height", 720)
      && Number(e.getAttribute("x") || 0) === 0 && Number(e.getAttribute("y") || 0) === 0 && !e.hasAttribute("transform");
  };
  const suppress = (parent: Element): boolean => {
    for (const element of children(parent)) {
      if (["defs", "style", "title", "desc", "metadata"].includes(element.localName ?? "")) continue;
      if (full(element)) {
        element.setAttribute("data-theme-original-opacity", element.getAttribute("opacity") ?? "");
        element.setAttribute("opacity", "0");
      } else if (element.localName === "g" && !element.hasAttribute("transform")) {
        if (!suppress(element)) return false;
      } else return false;
    }
    return true;
  };
  suppress(root);
  const layer = doc.createElementNS(NS, "g");
  layer.setAttribute("id", LAYER);
  layer.setAttribute("data-pptx-role", "background");
  const base = doc.createElementNS(NS, "rect");
  Object.entries({ width: "1280", height: "720", fill: theme.palette.bg }).forEach(([k, v]) => base.setAttribute(k, v));
  layer.appendChild(base);
  const image = doc.createElementNS(NS, "image");
  Object.entries({ id: "theme-image", x: "0", y: "0", width: "1280", height: "720", preserveAspectRatio: "xMidYMid slice", opacity: String(selection.intensity), href: `data:image/jpeg;base64,${background.toString("base64")}` }).forEach(([k, v]) => image.setAttribute(k, v));
  layer.appendChild(image);
  root.insertBefore(layer, root.firstChild);
  return serializer.serializeToString(doc);
}

export function stripThemeLayer(svg: string): string { return composeThemeBackground(svg, null); }

/** Samples use the project's text, not fabricated business claims. They are
 * labelled as composition samples in the UI, never as generated final pages. */
export function themeSampleSvg(input: { title: string; bullets: string[]; cover: boolean; selection: ThemeSelection; background: Buffer }): string {
  const theme = getDesignTheme(input.selection.themeId, input.selection.definition);
  const p = theme.palette;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const lines = (s: string, width: number, max: number) => {
    const chars = Array.from(s.replace(/\s+/g, " ").trim());
    const result: string[] = [];
    for (let i = 0; i < chars.length && result.length < max; i += width) result.push(chars.slice(i, i + width).join(""));
    if (chars.length > width * max) result[max - 1] = `${result[max - 1].slice(0, -1)}…`;
    return result;
  };
  const text = (s: string, x: number, y: number, size: number, color: string, width: number, max: number, weight = 400) => `<text x="${x}" y="${y}" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${lines(s, width, max).map((line, i) => `<tspan x="${x}" dy="${i ? size * 1.45 : 0}">${esc(line)}</tspan>`).join("")}</text>`;
  const content = input.cover
    ? `<rect x="76" y="192" width="58" height="5" rx="2" fill="${p.accent}"/>${text(input.title, 76, 283, 56, p.text, 13, 3, 700)}${text(input.bullets[0] || "", 80, 552, 23, p.muted, 26, 2)}`
    : `${text(input.title, 64, 92, 35, p.text, 31, 1, 700)}${input.bullets.slice(0, 3).map((bullet, i) => `<rect x="64" y="${157 + i * 157}" width="1152" height="136" rx="14" fill="${p.surface}" stroke="${p.line}"/><rect x="91" y="${189 + i * 157}" width="4" height="64" rx="2" fill="${p.accent}"/>${text(bullet, 119, 207 + i * 157, 26, p.text, 36, 2, 500)}`).join("")}`;
  return composeThemeBackground(`<svg xmlns="${NS}" viewBox="0 0 1280 720" width="1280" height="720">${content}</svg>`, input.selection, input.background);
}
