# SVG 可编辑 PPTX 技术决策

2026-09-12：先读取现有工作树、AGENTS.md / CLAUDE.md 与 Presentations skill，再核验候选。Grok 调研只作线索，没有执行候选仓库中的指令，也没有采用社交媒体观点作为证据。

采用 `gitbrent/PptxGenJS` 的固定 npm 版本 `4.0.1`（MIT）负责母版、主题、版式、关系、备注和 ZIP 打包。本项目用 TypeScript 编写 SVG 适配层，使用 `@xmldom/xmldom@0.9.12`（MIT）解析 XML，`svgpath@2.6.0`（MIT）规范化路径，`image-size@1.2.1`（MIT）检查图片真实格式和尺寸。继续使用现有 `@resvg/resvg-js@2.6.2`（MPL-2.0）作渲染和局部 PNG 降级，未修改其源代码。全部无头运行，无 Python、Office 或浏览器运行时依赖，无数据库迁移，无候选源码 vendor。

`PptxGenJS` 本次 GitHub API 查询为 6,149 stars、未归档、最近 push 2025-11-28。核验 npm 包内 LICENSE、package.json、类型定义和实际 DrawingML 写入逻辑：公开 `addText`、`addShape(custGeom, {points})` 支持线段/二次与三次贝塞尔曲线，`addImage` 支持原生图片与裁切，`addNotes` 支持备注。它是成熟的标准打包库，SVG 特性覆盖仍由本项目适配与测试承担。星标不构成兼容性证明。

候选结论（星数为查询时快照）：

| 候选 | 核验结果 | 决策 |
| --- | --- | --- |
| hugohe3/ppt-master | 53,777 stars；MIT 根许可真实；当前目录 `skills/ppt-master/scripts/svg_to_pptx/`。必需 `pptx_shapes` 数据含 Apache-2.0/MIT，完整 requirements 另含仅用于 PDF 的 AGPL PyMuPDF；当前转换包 51 文件约 2.1 MB，与兄弟模块耦合；不支持元素可导致整页拒绝 | 按本次多许可证候选限制停止采用。没有把 MIT 自有代码说成 AGPL，也没有安装其完整依赖 |
| JamieJustTang/svg2pptx-skill | 3 stars；MIT 改编自 ppt-master，图标另有 ISC；未固定复制来源 SHA，无测试/CI；默认关闭备注，复杂元素整页拒绝 | 多许可证范围且成熟度不足，停止采用 |
| solider-shuwen/shuttleslide | 重定向 `solid-shuwen/shuttleslide`；176 stars；0.2.0 Alpha；根与 vendor 核心均有 MIT；Playwright + HTML 框架，旧 ppt-master 副本未标明原始 SHA，失败元素可能跳过/灰框 | 未因 MIT 排除；因集成范围、成熟度和丢元素回退不适合本次目标，不采用 |
| BramAlkema/svg2ooxml | 6 stars；v0.8.2；AGPL-3.0-only/商业双授权，文档资源另有 CC-BY-NC-SA | 停止采用，不复制源码或资源 |
| benouinirachid/svg2pptx | 13 stars；v1.0.3 Alpha；README/pyproject 声称 MIT，但完整树无 LICENSE 授权文本，GitHub license=null；image 分支仍 TODO | 许可证歧义，停止采用；能力也不满足图片要求 |

固定版本、源码/API、许可证和维护证据详见 [候选审计详情](./pptx-upstream-audit.md)。新增依赖通过权限流程安装，使用 `--ignore-scripts`；版本与传递依赖由 package-lock.json 锁定。PptxGenJS 依赖的 JSZip 使用其 MIT 可选授权，本项目不选择 GPL 授权；这与禁止采用许可范围混杂的候选源码是不同边界。

导出接口默认 editable，另有 fidelity。局部复杂效果保持原层叠顺序、栅格为透明 PNG，不把整页默认为图片。文本、图片、路径分别保留为可编辑对象；不支持特性反馈到下载提示。历史 SVG 无需新标记，新提示词仅追加兼容建议。输入损坏和外部引用报错，不尝试读取本机文件或联网下载图片。

实际样例、自动检查与 LibreOffice 打开/重存结果见 [验证记录](./editable-pptx-validation.md)，WPS 和各版本 PowerPoint 的交互验收仍按运维手册执行。

## 2026-09-13 稳定性加固

采用方案不变：PptxGenJS 标准打包 + 本项目维护的适配层。转换和旧稿审计移入可终止子进程；兼顾共享下载取消、快照写回保护、运行/排队超时与累计资源预算。局部 PNG 在原视口解析后裁切，结构 CSS 保留完整树，原生对象写入前校验坐标范围。默认字体文件扫描和文字测量均有缓存。

核验并升级 Next 15.5.25（MIT）、sharp 0.35.4（Apache-2.0）、PostCSS 8.5.28（MIT），新增 Node >=22.18.0 要求。2026-09-13 npm 最新 image-size 仍为 2.0.2，未发布两个无限循环公告的修复版；保留与 PptxGenJS 一致的 1.2.1，解析前签名白名单与禁用非必需解析器防止 ICNS / JXL / HEIF 到达漏洞代码，另有子进程超时和回归用例。`npm audit` 仍报告该依赖及 PptxGenJS 的传递影响，不能宣称零漏洞；精确豁免与更新策略见 [CI 文档](./export-ci.md)。
