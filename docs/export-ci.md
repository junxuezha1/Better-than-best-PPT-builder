# 导出持续验证

`.github/workflows/ci.yml` 在 push、PR 和手动运行时，从干净克隆执行 `npm ci`，在 Node 22.22.0 / 24 上运行生产依赖审计、测试、类型检查与构建。测试使用合成数据，不请求模型、搜索服务或用户数据库。

随后生成两页可复现样例，核对 ZIP CRC、XML、内部关系、母版/版式/主题、16:9、页数、整数坐标、原生文字/形状/图片与备注，再使用 LibreOffice 转 PDF、重存 PPTX、检查重存包并重新打开。每次 Office 调用使用独立用户目录和 60 秒超时。Ubuntu 安装 Noto CJK 字体；输出保存为保留 14 天的 Actions artifact。

## 本地复现

```bash
npm ci
node scripts/check-dependency-audit.mjs
npm test
npm run typecheck
npm run build
node --experimental-strip-types scripts/export-editable-sample.ts
node --experimental-strip-types scripts/check-pptx-package.ts --mode=editable --slides=2 --notes output/editable-pptx-sample/svg-export-editable.pptx
node --experimental-strip-types scripts/check-pptx-package.ts --mode=fidelity --slides=2 --notes output/editable-pptx-sample/svg-export-fidelity.pptx
```

`tests/fixtures/sample-image.ts` 生成本项目自有的图片裁切校准图，不再读取用户的 `assets/site` 素材。源码 SVG 显式提供跨平台中文字体栈。`check-pptx-package.ts` 不传 `--mode` 时只验证通用结构；`--mode` 与 `--notes` 是此验收样例的语义断言，不用于强迫任意用户页面同时包含三类对象或指定备注文字。

## 依赖审计例外

2026-10-16 发布检查将 Next 更新至 15.5.28（MIT）、sharp 更新至 0.35.5（Apache-2.0），并将传递依赖 source-map-js 更新至 1.2.2（BSD-3-Clause），修复本次审计新增的缓存污染、图片解析和 source map 拒绝服务公告。保留原有图片签名检查、子进程预算与以下两项精确例外；不因升级扩大豁免。

当前上游 `image-size@1.2.1` 仍有两个未解决的高危公告：[ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)、[JXL / HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)。PptxGenJS 4.0.1 的依赖关系也被 npm audit 列为受影响；当前公开 2.0.2 不能消除全部公告。应用在解析前验证真实签名并只允许受审计图片格式，同时禁用危险格式，将解析/渲染放在可终止进程内。这是应用缓解措施，**不代表依赖本身已修复，也不应将原始审计报告称为无漏洞**。

`scripts/check-dependency-audit.mjs` 只放行这两个精确公告 URL、锁文件中的 `image-size@1.2.1`，以及仅由它产生的 `pptxgenjs@4.0.1` 影响。其它高危/严重问题、新公告、版本变化、未经检查的嵌套安装、网络失败、无效报告都会失败；没有按包名通配忽略。原始 `npm audit --omit=dev` 仍会显示已知问题。维护者应跟进上游修复，核验 API 与许可证后升级，再移除此例外。

LibreOffice 自动回归证明文件可打开和重存，不能替代 WPS、Mac/Windows PowerPoint 的人工编辑验收，也不能证明所有复杂 SVG 与所有字体完全一致。请继续按运维文档检查修改文字、更换/裁切图片、曲线编辑、备注及另存行为。
