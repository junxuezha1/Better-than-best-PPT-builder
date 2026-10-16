import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ImageModelConfig } from "./image-config.ts";

const BASE = "https://gotocc.xyz/v1";
const USER_AGENT = "gotocc-api-image-skill/1.0";
type Fetch = typeof fetch;
const headers = (key: string) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": USER_AGENT });

class ImageRequestRejected extends Error {}

async function imageErrorDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const data = JSON.parse((await boundedBody(response, 16 * 1024)).toString("utf8"));
    const message = typeof data.error?.message === "string" ? data.error.message
      : typeof data.message === "string" ? data.message : "";
    if (!message || /<\/?(?:html|body|script|!doctype)\b/i.test(message)) return "";
    return message.split(apiKey).join("[已隐藏]")
      .replace(/Bearer\s+\S+|\bsk-[a-zA-Z0-9_-]+/gi, "[已隐藏]")
      .replace(/[\r\n\t]+/g, " ").slice(0, 300);
  } catch { return ""; }
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body || Number(response.headers.get("content-length")) > limit) throw new Error("图片服务返回内容过大");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new Error("图片服务返回内容过大");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export async function listImageModels(config: Pick<ImageModelConfig, "apiKey">, signal?: AbortSignal, fetcher: Fetch = fetch): Promise<string[]> {
  const response = await fetcher(`${BASE}/models`, { headers: headers(config.apiKey), signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), redirect: "error" });
  if (!response.ok) throw new Error(`GotoCC 模型验证失败（HTTP ${response.status}），请检查图片 Key`);
  const data = JSON.parse((await boundedBody(response, 2 * 1024 * 1024)).toString("utf8"));
  if (!Array.isArray(data.data)) throw new Error("GotoCC 模型列表格式无法识别");
  return data.data.map((item: string | { id?: string }) => typeof item === "string" ? item : item?.id).filter((id: unknown): id is string => typeof id === "string");
}

export async function validateImageModel(config: ImageModelConfig, signal?: AbortSignal, fetcher: Fetch = fetch) {
  const models = await listImageModels(config, signal, fetcher);
  if (!models.includes(config.model)) throw new Error("此 GotoCC Key 无权使用所选图片模型，请重新拉取并选择模型");
}

function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return isIP(address) === 6 && !/^(::|fc|fd|fe[89ab]|ff)/i.test(address);
}
async function downloadImage(url: string, signal: AbortSignal, fetcher: Fetch): Promise<Buffer> {
  let target = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443")) throw new Error("图片服务返回了不支持的下载地址");
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("图片服务返回了非公开下载地址");
    // Never forward the API credential to a provider's image CDN.
    const response = await fetcher(target, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location"); if (!location) break;
      target = new URL(location, target); continue;
    }
    if (!response.ok) throw new Error(`生成结果下载失败（HTTP ${response.status}）`);
    return boundedBody(response, 10 * 1024 * 1024);
  }
  throw new Error("生成结果下载地址重定向过多");
}

/** Exactly one billed POST. A failed or uncertain result is never retried here. */
export async function generateBackgroundImage(config: ImageModelConfig, prompt: string, signal?: AbortSignal, fetcher: Fetch = fetch): Promise<Buffer> {
  if (!prompt.trim() || prompt.length > 20_000) throw new Error("背景提示词须为 1–20000 字符");
  const combined = AbortSignal.any([AbortSignal.timeout(240_000), ...(signal ? [signal] : [])]);
  try {
    const response = await fetcher(`${BASE}/images/generations`, {
      method: "POST", headers: headers(config.apiKey), signal: combined, redirect: "error",
      body: JSON.stringify({ model: config.model, prompt, n: 1, size: config.size, quality: "medium", output_format: "png", response_format: "b64_json" }),
    });
    if (!response.ok) {
      const detail = await imageErrorDetail(response, config.apiKey);
      const message = `GotoCC 图片请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`;
      if ([400, 401, 403, 404, 413].includes(response.status)) {
        throw new ImageRequestRejected(`${message}。请求被拒绝，未自动重试；请修正参数或配置后再生成。`);
      }
      throw new Error(message);
    }
    const result = JSON.parse((await boundedBody(response, 16 * 1024 * 1024)).toString("utf8"));
    const first = result.data?.[0];
    if (typeof first?.b64_json === "string" && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(first.b64_json)) {
      const bytes = Buffer.from(first.b64_json, "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("生成图片超过 10MB");
      return bytes;
    }
    if (typeof first?.url === "string") return await downloadImage(first.url, combined, fetcher);
    throw new Error("GotoCC 未返回可保存的图片");
  } catch (error) {
    if (error instanceof ImageRequestRejected) throw error;
    const message = error instanceof Error && /^(GotoCC|生成图片|生成结果|图片服务)/.test(error.message) ? error.message : "图片请求中断、超时或返回无法读取";
    throw new Error(`${message}。请求可能已计费，未自动重试；请检查 GotoCC 记录后手动重试。`);
  }
}
