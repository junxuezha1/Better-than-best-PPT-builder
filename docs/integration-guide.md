# 内部接口速查

这些接口服务于同仓库前端，不是公开多租户 API。应用没有登录鉴权，只应在本机或可信网络使用。

## 项目动作

`POST /api/projects/:id/actions` 接受 JSON：

| `type` | 其它字段 | 行为 |
|---|---|---|
| `resume` | 无 | 唤醒项目 worker |
| `cancel` | 无 | 中止当前请求并暂停 |
| `confirmRequirements` | `assumptions` | 确认需求并排队生成大纲 |
| `updateAssumptions` | `assumptions` | 更新假设并按失效范围重跑 |
| `reorderPages` | `pageIds` | 更新页面顺序并重算受影响页面 |
| `chat` | `pageId`, `message`, `surface` | 排队解析当前页改稿要求 |
| `structureChat` | `message`, `scope`, `scopeId` | 按整套、章节或页面生成结构提案，不直接修改项目 |
| `applyStructureProposal` | `proposalId` | 用户确认后应用提案并精确失效下游 |
| `dismissStructureProposal` | `proposalId` | 忽略待应用提案 |
| `confirmDesignReference` | `mode`, `styleId`, `colorPreference`, 可选 `theme`, `backgroundOnly` | 确认主题、风格或参考稿；同主题可仅替换背景 |

会触发长任务的动作返回 `202` 和当前项目快照。任务完成情况从 SSE 获取，不应重复轮询项目接口。

## 项目 SSE

连接 `GET /api/projects/:id/events`，监听命名事件：

```js
const source = new EventSource(`/api/projects/${projectId}/events`);
source.addEventListener("project", (event) => {
  const project = JSON.parse(event.data);
  // 用完整快照替换本地项目状态
});
```

服务端只在真实状态变化时推送；保活帧是 comment。客户端断线后交给 `EventSource` 自动重连。

项目快照读取和 SSE 建连会先执行一次带页面指纹缓存的 SVG 完整性审计。可无损提取的历史混杂输出会被规范化；不可渲染稿件会被清空并降为 `stale`。这属于本地数据自修复，不会在读取接口内调用模型；需要重新生成时由用户发送 `resume`。

## 页面更新

`PATCH /api/projects/:id/pages/:pageId` 支持 `title`、`bullets`、`speakerNotes`。服务端必须确认页面属于 URL 中的项目，错配时返回 `400`。

## 上传设计参考

`POST /api/projects/:id/reference` 使用 `multipart/form-data`，字段名为 `file`。仅接受 `.ppt`、`.pptx`、`.pdf`，最大 50MB；服务端校验扩展名和文件签名，拒绝宏文件。接口保存版本化本地产物、登记一次视觉分析任务并返回 `202` 项目快照。

上传成功不等于允许生成设计稿。前端需等待 `designReference.status` 变为 `ready`，展示风格画像，再调用 `confirmDesignReference`。分析失败时项目主流程保持可用，用户可重新上传或改选内置风格。

项目快照额外包含 `deckPlan`、`designReference`、`structureProposal` 和 `structureChat`。这些字段来自项目 sidecar 与事件，不需要客户端自行拼接。

## AI 背景与图片配置

`GET /api/settings/images` 返回脱敏配置，不含 Key；`POST` 接受可选 `apiKey`，否则使用已保存 Key，只访问 GotoCC `/v1/models`。`PUT` 接受 `{ apiKey, model }`，留空 Key 保留旧值，验证精确模型权限后以 0600 保存本机 sidecar。保存动作即确认本机存储，不再要求分组或额外勾选；历史字段兼容读取。AI 在视觉方案的 `coverSize` / `bodySize` 中选择接口支持的横向尺寸，缺省或非法值回退 `auto`。没有图片 POST 或数据库迁移。

`POST /api/projects/:id/theme/generate` 接受 `{ mode: "plan" | "generate" | "retry", brief, reusePlan?, coverPrompt?, bodyPrompt? }`，只登记任务并返回 202。`plan` 只调用文本模型；`generate` 规划并生成两张图片，或 `reusePlan=true` 且 brief 未变化时使用当前方案与编辑后的提示词；`retry` 仅对失败/中断任务补未完成部分。项目必须非运行、全部初稿就绪且不受品牌锁定。

项目 SSE 快照包含 `backgroundGeneration`（状态、完整视觉方案、提示词、已保存图片、待确认候选、错误和实际模型/尺寸）及 `imageGenerationConfigured`。状态为 `idle / planning / planned / generating_cover / generating_body / ready / failed / interrupted`。完成不自动修改 `designTheme.selection`；用户确认时发送候选选择。图片 POST 从不自动重试，重启不确定任务会标记 `interrupted`。

`designTheme.selection` 为 `{ themeId, intensity, coverAssetId, bodyAssetId, definition? }`。AI 方案使用 `ai_<uuid>` 标识和动态 `definition`，服务端校验其属于当前项目且与已登记视觉合同一致；旧 `glacier / midnight / executive` 仅兼容历史项目。强度 0–1，AI 方案必须有两张本项目素材。确认动作省略 `theme` 保留当前选择，显式 `null` 停用。

`POST /api/projects/:id/theme` 接受 multipart `file`，校验静态 PNG/JPEG/WebP，最大 10MB、2400 万像素、每项目 20 张，返回 `{ asset, designTheme }`，不自动应用。`GET` 接受 `themeId`、`intensity`、`role=cover|body`、两个素材 ID，返回使用当前内容的 SVG 样张；`exact=true&pageId=...` 预览现有设计替换背景。校验项目归属，禁止缓存。

确认动作带 `backgroundOnly: true` 时，仅允许非运行项目、同一主题 ID 和已有就绪设计稿；同步更新背景，不调用模型。新视觉合同需正常确认，仅使设计稿失效。品牌锁定项目保持原规则。

## 导出 PPTX

`GET /api/projects/:id/export?mode=editable` 导出可编辑版，`mode=fidelity` 导出整页 PNG 的高保真版。省略 `mode` 默认采用 `editable`，其它值返回 `400 / INVALID_MODE`。

接口在本机审计稿件后，按 `sort_order` 导出全部页面。只有每页都有非空 SVG 且 `design_status=ready` 才可导出；不会过滤坏页或缺页。保留稿件内的标题与内容，并把 `speaker_notes` 写入备注，两个模式均为 16:9。

成功响应为二进制 PPTX：

| 响应头 | 含义 |
| --- | --- |
| `Content-Type` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `Content-Disposition` | `attachment`，同时提供 ASCII `filename` 和 UTF-8 `filename*`；文件名移除非法字符与保留名称并限制长度，后缀区分模式 |
| `X-PPTX-Mode` | 本次采用的 `editable` 或 `fidelity` |
| `X-PPTX-Fallback-Count` | 可编辑转换的降级记录总数，通常对应被图片化的复杂元素或分组；`0` 表示没有降级记录 |
| `X-PPTX-Fallback-Slides` | 降级所在页码，从 1 开始，去重排序，以逗号连接；没有降级时为空 |
| `Cache-Control` | `no-store` |

高保真模式本来就使用整页图片，因此其降级数量为 `0` 不表示页面可编辑。可编辑版降级范围详见[支持矩阵](./architecture.md#pptx-导出)。

前端使用 fetch，先检查 HTTP 状态和 MIME，再以 Blob 下载；优先使用 UTF-8 附件名，显示降级提示并回收下载 URL。错误保持 JSON `{ "error": "可读错误摘要", "code": "错误代码" }`，不得当作 `.pptx` 保存。错误摘要只使用应用定义的消息，不透传路径、XML 或第三方库异常。

缓存驻留当前进程，最多 8 份 / 64MB；指纹包含模式、标题、页面内容、备注和顺序，不依赖更新时间。相同内容的并发下载合并，同项目不同导出串行；最多登记 16 项未完成任务，超出时返回 `429 / EXPORT_BUSY`。失败不缓存。请求处理期间使用已经审计的内容快照，后续编辑会在下一次下载时产生新指纹。

计算另受共享子进程池限制：1 个执行、4 个排队、45 秒执行超时、90 秒排队超时。`RESOURCE_LIMIT` 表示工作量预算耗尽；`EXPORT_TIMEOUT` 为 504，`EXPORT_CANCELLED` 为 499，`EXPORT_STALE` 为 409。审计并发冲突请刷新后重试，运行故障不会清空 ready 稿件。

库接口保留 `buildPptx(inputs, options) -> Promise<Buffer>`，并提供 `buildPptxDetailed(inputs, options)` 返回 `buffer`、`warnings`、`nativeTextCount`、`nativeShapeCount`、`nativeImageCount`。`inputs` 可继续使用旧 `string[]`，或使用 `{ svg, title?, notes? }[]`；数组顺序就是页面顺序，`options` 为 `{ mode?, title? }`。两接口均可传第三个 `AbortSignal`。库不读取数据库，适合离线样例和测试；运行目录需包含构建追踪的 worker 源文件，Node >=22.18。

## 常见响应

| 状态码 | 含义 |
|---|---|
| `200` | 同步读取或更新完成 |
| `202` | 动作已登记，worker 在后台处理 |
| `400` | 参数、项目/页面归属、动作类型或导出模式错误 |
| `404` | 项目不存在或 SSE 目标不存在 |
| `409` | 仍有设计稿未完成、页面归属/顺序无效或完整性审计发现坏稿，不能导出 |
| `422` | 导出输入的 XML、画布、资源安全或大小限制不合格 |
| `429` | 导出队列已满，稍后重试 |
| `499` | 调用者已取消下载 |
| `504` | 导出执行或排队超时 |
| `500` | PPTX 转换或打包失败；可重试或选择高保真模式 |

错误响应使用 `{ "error": "可读错误摘要" }`。上游 HTML 错误页不会原样透传到界面。
