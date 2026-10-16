# SVG 可编辑 PPTX 验证记录

验证日期：2026-09-12。技术选择与许可证据见 [技术决策](./editable-pptx-decision.md) 和 [上游审计](./pptx-upstream-audit.md)。

## 自动检查

- `npm run typecheck`：通过。
- `npm test`：82 项通过。测试使用内存 fixture，不访问真实模型、搜索服务或用户数据库。
- `npm run build`：通过，包含导出 API 和项目页面。
- `git diff --check`：通过。

导出测试覆盖原生文本、自定义几何与贝塞尔路径、图片原始字节与矩形裁切、中文字体声明、页面顺序、备注、ZIP CRC、全部 XML 和内部关系目标。另覆盖局部渐变/蒙版、跨分支 `use` 引用、旧图片 MIME 错标、嵌套 SVG 安全校验、文本透明度与混排降级、CSS 样式、HTTP 缓存与排队、合法文件名、降级页码和错误净化。

## 实际文件

运行 `node --experimental-strip-types scripts/export-editable-sample.ts`，生成 `output/editable-pptx-sample/`：

| 文件 / 页 | 文本段 | 原生自定义几何 | 图片 |
| --- | ---: | ---: | ---: |
| svg-export-editable.pptx / 1 | 7 | 5 | 1 张原始照片，带裁切 |
| svg-export-editable.pptx / 2 | 7 | 3 | 1 张渐变阴影局部图片 |
| svg-export-fidelity.pptx / 每页 | 0 | 0 | 1 张完整页面 PNG |

两种文件都有两页和中文演讲备注。可编辑版的 `a:t`、`a:custGeom`、`p:pic` 和 `a:srcRect` 均从实际 ZIP/XML 中核对。`inspection.json` 保存原始导出统计。

## LibreOffice 打开与重存

使用本机 `LibreOfficeDev 26.8.0.0.alpha0` 无头运行，每次使用隔离用户目录：

1. 打开两种原始 PPTX 并转为 PDF，成功退出。
2. 逐页查看四张渲染图：中文可读、图像与曲线可见、页面顺序正确，局部阴影没有截断。
3. 将两种文件分别另存为新 PPTX，保存在 `verified/roundtrip/`。
4. 对另存包重新检查 ZIP/XML、内部关系、文字、图片裁切与备注，全部通过。LibreOffice 将第一页一个文本段拆成两段，独立形状与图片数量保持不变。
5. 再次打开两个重存文件并转为 PDF，成功退出，结果位于 `verified/reopened/`。

`verified/package-check.json` 保存原包和重存包的 SHA-256、对象数量及包完整性结果。`verified/` 也保存 PDF 与逐页预览图。

该无头 LibreOffice 默认未正确加载中文字体。按 [运维说明](./operator-runbook.md#中文字体) 为验证进程设置临时 `FONTCONFIG_FILE` 后，中文正常。没有修改系统字体、Office 日常配置或用户已有文档。

## 兼容性边界与人工验收

尚未完成 WPS、Mac PowerPoint、Windows PowerPoint 的交互编辑与另存验收；LibreOffice 成功不能替代各应用版本的验证。请按 [人工验收步骤](./operator-runbook.md#pptx-样例与打开验收) 打开可编辑样例，修改标题与数字、更换和裁切右侧图片、修改曲线顶点，核对第二页局部图片、备注与顺序，再另存并重新打开。高保真样例需检查视觉与打开行为。

字体不内嵌，跨平台字体替换可能改变字宽与基线；需要严格视觉一致时使用高保真模式。渐变、滤镜、蒙版、特殊文本和部分 CSS 会局部图片化；依赖兄弟元素的 CSS 需保留对应父分组，全局规则可能扩大到整页。SVG 图表转换为形状、路径与文本，没有 Office 图表工作簿或表格语义。

原有工作树按修改前哈希核对：没有缺失文件，无关用户文件未变；变动限于本次导出实现、依赖、提示词追加、入口交互、相关文档与构建缓存。未创建提交，无数据库迁移。
