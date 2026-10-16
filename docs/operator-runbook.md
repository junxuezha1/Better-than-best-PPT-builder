# 本地运行与排障

## 启动

运行和测试均需要 Node.js 22.18.0 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，在设置页分别配置文本、SVG 和搜索模型。API Key 只存放在 `data/ppt-agent.db`，不得写入日志、截图、提交或文档。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

浏览器冒烟至少检查：

1. 首页只请求一次 `/api/bootstrap`。
2. 项目页只请求一次项目快照，并保持一条 `/events` SSE。
3. 空间结构板可平移、缩放、全局查看；拖动页面只改变语义顺序，双击产物能进入对应工作台 surface。
4. Script Desk 的整套/章节/当前页范围正确；输入后按钮启用，但未经用户点击“应用”不会修改页面。
5. 全部初稿完成后能停在设计参考门禁；内置风格可直接确认，上传参考稿会显示处理、就绪或失败状态。
6. 搜索/初稿/设计稿切换不改变当前页；窄屏不会让画布被侧栏挤成不可用尺寸。
7. 控制台没有 error 或 warning。

背景冒烟使用隔离测试数据与模拟文本、图片接口：先规划完整提示词并确认没有图片调用，再配置模拟 GotoCC，生成两张背景。检查生成不自动应用、提示词编辑生效、动态前景配色、部分成功后只重试缺失图片、取消及重启不重复收费请求，以及桌面/390px 窄屏。确认后背景进入最终 SVG；同视觉合同仅换背景须保持前景与调用数。导出后检查独立图片和文字并用 LibreOffice 转换。

真实图片配置只填写 Key 和模型，随页面统一的「保存配置」操作通过只读模型列表验证并保存。无需分组、尺寸或额外确认；AI 自主选择封面与正文的尺寸，缺省为 `auto`。图片配置文件 `data/image-settings.json` 仅本机可读写；不会复用文本/SVG/搜索 Key。生成按钮会提示消耗余额，图片超时或失败后应先核对 GotoCC 记录，再明确重试。继续项目不等于允许重新扣费。

导出验证覆盖 `tests/export*.test.ts` 和依赖审计测试：原生文本/形状/图片、页面顺序、备注、ZIP/XML/关系完整性、局部降级、模式缓存与 HTTP/下载错误。不要以每页只有一个媒体文件作为可编辑版的验收标准。干净安装、已知漏洞缓解与 LibreOffice 持续回归见 [CI 维护说明](./export-ci.md)。运行环境需要 Node >=22.18.0；保留 scripts/pptx-export-worker.ts 及 Next 追踪文件。

## PPTX 样例与打开验收

在仓库根目录使用 Node.js 22.18.0 或更高版本：

```bash
node --experimental-strip-types scripts/export-editable-sample.ts
```

脚本使用 `tests/fixtures/sample-image.ts` 生成图片裁切校准图，不读取用户素材或项目数据库、不调用模型。默认输出至 `output/editable-pptx-sample/`，也可传入其它输出目录作为第一个参数：

- `svg-export-editable.pptx`：两页原生文本、基本图形、曲线、图片和局部复杂效果。
- `svg-export-fidelity.pptx`：相同页面的完整 PNG 版本。
- `source-1.svg` / `source-2.svg` 及 PNG：视觉对照。
- `inspection.json`：每页文本、路径、图片数量与降级记录。

用 `unzip -t output/editable-pptx-sample/svg-export-editable.pptx` 检查压缩完整性。可编辑版的 `ppt/slides/slide*.xml` 应包含 `a:t`、`a:custGeom` 和 `p:pic`，图片关系指向实际媒体，`a:srcRect` 表示裁切；不应每页只有一张完整画面。备注应在 `ppt/notesSlides/` 中。更全面的引用完整性由回归测试验证。

安装 LibreOffice 的环境可用独立配置目录进行 PDF 转换，避免占用日常 Office 会话。下面以 `soffice` 在 PATH 中为例，macOS 常见路径为 `/Applications/LibreOffice.app/Contents/MacOS/soffice`：

```bash
soffice -env:UserInstallation=file:///tmp/ppt-agent-export-check --headless --convert-to pdf --outdir output/editable-pptx-sample/lo-pdf output/editable-pptx-sample/svg-export-editable.pptx
soffice -env:UserInstallation=file:///tmp/ppt-agent-export-check --headless --convert-to pptx --outdir output/editable-pptx-sample/lo-resaved output/editable-pptx-sample/svg-export-editable.pptx
```

转换进程应正常退出且实际产生非空文件；另存到新目录后再次打开，不覆盖原样例。PDF 成功生成只证明一条打开/转换路径，应继续逐页查看图像和文字。高保真版重复同样检查。

WPS、Mac PowerPoint、Windows PowerPoint 人工验收：

1. 打开两种样例，无“修复文件”提示，页数为 2、比例 16:9、顺序与源图一致。
2. 可编辑版第 1 页分别选中标题、正文、数字并修改；选择线条或曲线，确认能够移动和编辑顶点。
3. 选中第 1 页右侧图片，执行“更换图片”和“裁切”，确认图片对象独立于背景和文本。
4. 第 2 页的渐变/阴影效果保留为局部图片；效果外的标题、正文、圆形和曲线仍可单独选中。核对下载提示中的降级页码。
5. 检查中文无缺字、文字不溢出、阴影边界和图片比例正确、演讲备注仍在；分别另存为新文件、关闭并重新打开，再次编辑文字与图片。
6. 在真实项目菜单中试用两种模式；生成中重复点击不会重复发起请求，Escape 和点击菜单外部可关闭，失败留在编辑器显示。未完成项目不能导出。

以上为验收步骤，不代表本地安装的所有 Office 应用和版本已通过验证。发布时应另行记录实际应用版本、打开与重存结果及残余显示差异。

### 中文字体

可编辑文本不内嵌字体。生成端默认在 macOS 使用可用的 `Hiragino Sans GB`，Windows 使用 `Microsoft YaHei`，其它环境使用 `Noto Sans CJK SC`。Linux 无中文字体时先通过系统字体管理器安装 Noto CJK 并重启应用；自定义品牌字体也需要在生成端和打开端安装。保持两端字体一致可减少字宽变化。高保真版使用生成时的字形，但生成端缺字仍须先修复。

本次 macOS 样例验证中，LibreOffice 的无头进程需要显式字体目录才能正常转换中文；为验证进程指定下列 Fontconfig 文件后，两页 PDF 的中文恢复正常。该配置仅用于此进程，不修改系统字体或日常 LibreOffice 设置：

```bash
cat > /private/tmp/ppt-export-fonts.conf <<'EOF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/System/Library/Fonts</dir>
  <dir>/System/Library/Fonts/Supplemental</dir>
  <dir>/Library/Fonts</dir>
  <cachedir>/private/tmp/ppt-export-font-cache</cachedir>
</fontconfig>
EOF
FONTCONFIG_FILE=/private/tmp/ppt-export-fonts.conf /Applications/LibreOffice.app/Contents/MacOS/soffice -env:UserInstallation=file:///tmp/ppt-agent-export-check --headless --convert-to pdf --outdir output/editable-pptx-sample/lo-pdf output/editable-pptx-sample/svg-export-editable.pptx
```

在同一台 Mac 上执行上述另存或高保真验证时，也在命令前添加 `FONTCONFIG_FILE=/private/tmp/ppt-export-fonts.conf`。这项中文渲染修复不代表 WPS 或各版本 PowerPoint 已完成打开、编辑和重存验收。

### 旧 WPS 修复脚本

`scripts/make-wps-compatible-pptx.py` 只针对旧手写导出包中的 `ppt/media/imageN.png` 重新包装，不支持新包的媒体命名，也不保留原生对象。当前应直接选择「高保真 PPTX」，不要再把新可编辑文件送入该脚本。

## 故障定位

### 模型容量已满、429、502、503、504、524

普通生成调用使用短退避重试；搜索调用使用 5、15、30、45 秒退避。右侧进度会显示重试次数。暂停项目会立即中止请求和等待。持续 524 通常说明兼容网关无法保持 Responses SSE，应更换网关或使用供应商直连接口。

### 项目看起来没有进度

先看浏览器 Network 中 `/api/projects/:id/events` 是否保持 pending，再看右栏的有限状态事件。不要通过刷新或新增轮询解决；刷新会重新建立 SSE，但不会创造第二个 worker。

### 改稿没有执行

改稿动作应返回 `202`。worker 被新指令中止时，旧指令会保留在项目内存队列并在下一轮继续。模型返回的结构不合法时，Script Desk 会显示局部错误，不会把整个项目标记为失败。进程重启会丢失尚未落库的内存改稿队列，因此不要在收到 `202` 后立即终止开发服务器。

### 参考稿分析失败

PPT/PPTX 分析依赖可执行的 `soffice` 或 `libreoffice`，PDF 页数和渲染依赖 Poppler 的 `pdfinfo`、`pdftoppm`。缺少工具时界面会保留在设计参考门禁，可改传 PDF、重新上传或选择内置风格；不会影响已经完成的资料和初稿。参考模型必须支持图片输入。

### 导出被拒绝

`409` 通常表示至少一页设计稿尚未完成或审计发现坏稿。应用不会过滤缺页后生成不完整 PPTX；继续项目并等待全部页面 `design_status=ready`。页面归属或顺序无效也返回 `409`，先刷新并核对项目。

`400` 检查 `mode` 是否为 `editable` 或 `fidelity`；`422` 检查提示中的页码、SVG 完整性、嵌入图片和资源大小；`429` 等候现有导出完成后重试。`504` 表示执行或排队超时，拆分文稿或减少复杂效果；`499` 表示请求取消；`409 / EXPORT_STALE` 刷新后重试。`500` 可重试或切换高保真；损坏或含外部资源的 SVG 在两种模式下都会拒绝。具体限额与支持范围见[架构文档](./architecture.md#pptx-导出)。

### 部分内容只能选中为图片

确认下载的是「可编辑 PPTX」。渐变、滤镜、蒙版、复杂分组与特殊文字布局会按局部保真策略图片化，结构 CSS 选择器和全局 at-rule 可能扩大到整页。下载提示会给出数量和页码；可根据[支持矩阵](./architecture.md#pptx-导出)简化该区域，再导出。备注、排序和 SVG 变化会自动使缓存失效，无需清库。

### 缩略图或画布显示空白、破图

刷新项目页会触发一次本地 SVG 完整性审计，不会调用模型。若模型在真实 SVG 前输出了解释文字，系统会提取并保存唯一可渲染根节点；若 XML 损坏、渲染为空白或没有可见内容，该稿件会被清空并降为 `stale`，项目转为暂停且导出返回 `409`。点击「继续」只重生成受影响的下游阶段。不要手工把状态改回 `ready`。

## 数据边界

- `data/`：用户数据库和密钥，不提交。
- `data/artifacts/<projectId>/`：Deck Plan、结构提案、风格画像和版本化参考文件，不提交。
- `output/`：本地演示文稿、预览、备份和验证产物，不提交。
- `.next/`、`node_modules/`：构建与依赖产物，不提交。
