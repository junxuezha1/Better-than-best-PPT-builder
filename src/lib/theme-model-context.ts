import type { ChatContentPart } from "./llm.ts";

/** Decoration is a separate input role from evidence and content photographs. */
export function withThemeBackground(content: string | ChatContentPart[], data?: string): string | ChatContentPart[] {
  if (!data) return content;
  return [
    ...(typeof content === "string" ? [{ type: "text" as const, text: content }] : content),
    { type: "text", text: "以下是系统将自动铺在底层的实际主题背景。只观察画面与留白，按主题合同生成独立前景；不要重画、嵌入或把这张装饰图当作业务事实。" },
    { type: "image", mimeType: "image/jpeg", data },
  ];
}
