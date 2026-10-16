# 当前实现交接

## 已具备

- 一句话主题、项目级调研、内容需求单、空间结构板、页面检索、统一 Deck Plan、初稿、设计参考门禁、设计稿和 PPTX 导出主链路。
- 文本、SVG、搜索三套独立模型配置，支持 Responses、Messages、Gemini 和 Chat Completions。
- 项目单 worker、真实请求取消、页面/结构改稿队列、阶段批处理和下游精确失效；交互型失败与整条生成链隔离。
- Responses SSE 解码、有限重试、净化错误、搜索来源结构约束和 URL 缓存。
- 一次初始项目读取 + SSE 快照的前端数据流，没有项目轮询。
- Spatial Editorial Atelier 空间画布、右侧 Script Desk、Blueprint Atelier 编辑台、Lucide 功能图标和无 emoji 契约。
- 结构修改先生成完整提案和 diff，用户应用后才修改；章节页实体化为独立 `section` 页。
- Deck Plan 一次性约束跨页字阶、网格、卡片和视觉槽位，初稿为照片、图表、关系图或 SVG 插画保留明确表达位置。
- 最终设计前支持内置风格/颜色或 PPT、PPTX、PDF 参考；本机隔离转换、抽样视觉分析和用户确认后才继续。
- AI 原创背景：文本模型按项目内容规划完整提示词，GotoCC 生成封面/正文配套背景；支持编辑提示词、独立图片配置、部分失败续做、强度调整与准确预览。确认后只重做设计，同一视觉合同可只换背景。
- 双模式导出菜单：可编辑版转换文本、几何路径和图片，高保真版保留整页 PNG；均由 PptxGenJS 标准打包并保留顺序和演讲备注。
- 复杂 SVG 元素或分组可局部图片化，下载后提示数量与页码。导出缓存按模式和完整内容指纹隔离、同项目串行、相同并发请求合并；缺页、非法 SVG 和导出错误留在工作台提示。
- 原帖大纲与内容页 SVG Prompt 核心已作为不可改写契约保留；内容页 Bento 与固定页型分流，设计阶段允许受控视觉重构。
- SVG 写入前执行独立根节点提取、XML/Resvg 渲染与空白检测，并拒绝占位文案、外部内容和封面模板元数据；无效结果只做一次定向修复，仍不合格就停止当前页。
- 历史稿件读取、继续和导出前执行带指纹缓存的完整性审计；可修复的混杂输出自动规范化，不可修复稿件降为 `stale` 并阻止导出。

## 约束

- 本机单用户，没有鉴权、云端队列或多实例协调。
- 改稿队列在内存中，尚未落库的指令不跨进程重启。
- 参考 PPT/PPTX 分析依赖本机 LibreOffice；PDF 分析依赖 Poppler；所选 SVG 模型必须支持图片输入。
- 可编辑导出并非完整 SVG / CSS 实现。复杂效果和文本可能局部图片化，全局 CSS at-rule 当前可能导致整页图片化；支持矩阵见[架构文档](./architecture.md#pptx-导出)。
- SVG 图表仍由原生形状、路径和文本组成，没有图表工作簿或 Office 表格语义。高保真版只有整页图片。
- 字体不会嵌入；生成端与打开端需要可用中文字体，跨平台的字宽、换行和重存结果仍需人工验收。
- 搜索质量取决于所选模型和网关是否真实支持联网工具与 Responses SSE。
- GotoCC 图片设置仅保留 Key、模型和拉取入口，随页面统一保存；分组不再参与校验，尺寸由 AI 自主选择，缺省为 `auto`。自动化验收只使用模拟图片服务，不代表真实模型的视觉质量已验收；实际效果需要配置后生成一套作品检查。

## 背景维护入口

- `background-prompts.ts`：完整艺术指导与图片硬性约束；`background-generation.ts`：逐张保存、失败恢复与生成状态。
- `gotocc-images.ts` / `image-settings.ts`：GotoCC 单次图片请求、只读模型验证、图片配置与 Key 脱敏。
- `theme-catalog.ts` / `theme-assets.ts` / `theme-composer.ts`：动态视觉合同、项目素材归属与独立背景合成；旧静态素材仅作历史兼容。
- `ThemeChooser.tsx` / `DesignReferenceGate.tsx` / `ImageSettingsCard.tsx`：背景工作室、确认与图片设置。
- `tests/background-generation.test.ts` / `tests/themes.test.ts`：权限配置、单次图片请求、不自动重试、部分结果续做、动态方案、素材隔离与可编辑导出。
- [背景生成说明](./background-generation.md)：产品流程、提示词与真实效果验收边界。

## 导出维护入口

- `src/lib/export-service.ts`：审计、排序、内容指纹缓存和 HTTP 错误。
- `src/lib/export-pptx.ts` 与 `svg-pptx*.ts`：标准打包、SVG 转换、局部降级和字体选择。
- `tests/export.test.ts`、`tests/export-service.test.ts`、`tests/export-download.test.ts`：对象、包、接口和下载错误回归；不读取用户数据库。
- `scripts/export-editable-sample.ts`：生成两页可编辑 / 高保真样例、源 SVG / PNG 和对象检查报告；运行及打开重存步骤见[运维文档](./operator-runbook.md#pptx-样例与打开验收)。
- [技术决策](./editable-pptx-decision.md)和[候选审计](./pptx-upstream-audit.md)：核验后的上游选择与许可边界。新增 MIT 依赖为 PptxGenJS、xmldom、svgpath、image-size；无候选源码 vendor，无数据库迁移。

自动 ZIP/XML 检查不等同于 WPS、Mac/Windows PowerPoint 的视觉验收。每次发布前记录所用应用版本、能否无修复提示打开、编辑图片与文字后能否另存重开，以及备注、顺序和字形是否保留。

## 继续开发前

完整阅读根目录 `AGENTS.md` 与 `CLAUDE.md`。行为变更先更新 `CLAUDE.md`，再改代码；最后运行测试、类型检查、生产构建和浏览器冒烟。
