import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@resvg/resvg-js"],
  // Runtime artifacts and local settings must never enter a deployment bundle.
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./.env*", "./output/**/*"] },
  outputFileTracingIncludes: {
    "/api/projects/**/*": ["./public/themes/**/*", "./scripts/pptx-export-worker.ts", "./src/lib/**/*.ts", "./node_modules/pptxgenjs/**/*", "./node_modules/https/**/*", "./node_modules/@xmldom/xmldom/**/*", "./node_modules/svgpath/**/*", "./node_modules/image-size/**/*", "./node_modules/@resvg/**/*", "./node_modules/jszip/**/*", "./node_modules/pako/**/*", "./node_modules/lie/**/*", "./node_modules/immediate/**/*", "./node_modules/readable-stream/**/*", "./node_modules/setimmediate/**/*", "./node_modules/safe-buffer/**/*", "./node_modules/string_decoder/**/*", "./node_modules/util-deprecate/**/*", "./node_modules/inherits/**/*", "./node_modules/core-util-is/**/*", "./node_modules/isarray/**/*", "./node_modules/process-nextick-args/**/*", "./node_modules/queue/**/*"],
  },
  // Next.js 开发浮层只有英文，没有 locale。关掉，避免当成产品设置。
  devIndicators: false,
};

export default nextConfig;
