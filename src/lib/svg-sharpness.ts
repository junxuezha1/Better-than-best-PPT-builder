const FILTERED_CONTAINER_TAGS =
  /<(?:svg|g|a|symbol|switch|use|text|tspan|textPath)\b[^>]*>/gi;

/**
 * WebKit rasterizes filtered SVG containers before scaling the slide image.
 * Removing filters from text-bearing containers keeps text and line work sharp;
 * filters attached directly to geometry such as rect/path remain available.
 */
export function normalizeSvgForSharpText(svg: string): string {
  if (!svg || !/filter/i.test(svg)) return svg;

  return svg
    .replace(FILTERED_CONTAINER_TAGS, (opening) => stripFilterAttributes(opening))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) =>
      block.replace(/(^|[;{])\s*filter\s*:[^;}]+;?/gi, "$1"),
    );
}

function stripFilterAttributes(opening: string): string {
  return opening
    .replace(/\sfilter\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_match, quote: string, style: string) => {
      const declarations = style
        .split(";")
        .map((item) => item.trim())
        .filter((item) => item && !/^filter\s*:/i.test(item));
      return declarations.length ? ` style=${quote}${declarations.join("; ")}${quote}` : "";
    });
}
