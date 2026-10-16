export const MATERIAL_UPLOAD_LIMIT = 100 * 1024 * 1024;
export const MATERIAL_FILE_LIMIT = 50 * 1024 * 1024;
const MULTIPART_LIMIT = MATERIAL_UPLOAD_LIMIT + 1024 * 1024;

export interface MaterialProjectRequest {
  requestText: string;
  brandTemplateId?: string;
  usePreparedPlan: boolean;
  files: Array<{ name: string; bytes: Buffer }>;
}

async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("上传总大小不能超过 100MB（单个文件不超过 50MB）");
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", cancelReader, { once: true });
  try {
    for (;;) {
      if (request.signal.aborted) throw new Error("上传已取消");
      const { done, value } = await reader.read();
      if (request.signal.aborted) throw new Error("上传已取消");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("上传内容超过大小限制");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    request.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Supports the existing JSON API and the content-material multipart form. */
export async function parseMaterialProjectRequest(request: Request): Promise<MaterialProjectRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  let requestText = "";
  let brandTemplateId: string | undefined;
  let usePreparedPlan = false;
  const files: MaterialProjectRequest["files"] = [];
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const bytes = await boundedBody(request, MULTIPART_LIMIT);
    const form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
    const text = form.get("requestText");
    const brand = form.get("brandTemplateId");
    if (text !== null && typeof text !== "string") throw new Error("主题格式不正确");
    if (brand !== null && typeof brand !== "string") throw new Error("品牌模板格式不正确");
    requestText = (text ?? "").trim();
    brandTemplateId = typeof brand === "string" ? brand.trim() || undefined : undefined;
    usePreparedPlan = form.get("usePreparedPlan") === "true";
    const uploaded = form.getAll("files");
    if (uploaded.length > 20) throw new Error("一次最多上传 20 个文件");
    let total = 0;
    for (const file of uploaded) {
      if (typeof file === "string") throw new Error("上传资料格式不正确");
      if (!file.size) throw new Error(`文件为空：${file.name}`);
      if (file.size > MATERIAL_FILE_LIMIT) throw new Error(`单个文件不能超过 50MB：${file.name}`);
      total += file.size;
      if (total > MATERIAL_UPLOAD_LIMIT) throw new Error("上传文件合计不能超过 100MB");
      files.push({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    }
  } else {
    const bytes = await boundedBody(request, 256 * 1024);
    let body: unknown;
    try { body = JSON.parse(Buffer.from(bytes).toString("utf8")); }
    catch { throw new Error("创建请求不是有效 JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("创建请求格式不正确");
    const fields = body as Record<string, unknown>;
    if (fields.requestText !== undefined && typeof fields.requestText !== "string") throw new Error("主题必须是文字");
    if (fields.brandTemplateId !== undefined && typeof fields.brandTemplateId !== "string") throw new Error("品牌模板格式不正确");
    requestText = typeof fields.requestText === "string" ? fields.requestText.trim() : "";
    brandTemplateId = typeof fields.brandTemplateId === "string" ? fields.brandTemplateId.trim() || undefined : undefined;
  }
  if (requestText.length > 20_000) throw new Error("主题要求最多 20000 字；长文请作为资料上传");
  if (!requestText && !files.length) throw new Error("请输入主题或上传内容资料");
  return { requestText: requestText || "根据上传资料制作演示", brandTemplateId, usePreparedPlan, files };
}
