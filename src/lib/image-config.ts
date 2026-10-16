export const IMAGE_SIZES = ["auto", "2560x1440", "1536x1024", "3840x2160"] as const;
export type ImageSize = typeof IMAGE_SIZES[number];
export function resolveImageSize(value: unknown): ImageSize {
  return typeof value === "string" && (IMAGE_SIZES as readonly string[]).includes(value) ? value as ImageSize : "auto";
}
export interface ImageModelConfig {
  provider: "gotocc";
  apiKey: string;
  model: string;
  size: string;
}
export interface PublicImageConfig extends Omit<ImageModelConfig, "apiKey"> { hasKey: boolean; configured: boolean }
export const DEFAULT_IMAGE_CONFIG: ImageModelConfig = {
  provider: "gotocc", apiKey: "", model: "gpt-image-2", size: "auto",
};

export function parseImageConfig(value: unknown, savedKey = ""): ImageModelConfig {
  if (!value || typeof value !== "object") throw new Error("图片模型配置不完整");
  const item = value as Record<string, unknown>;
  const str = (key: string) => typeof item[key] === "string" ? (item[key] as string).trim() : "";
  const config: ImageModelConfig = { provider: "gotocc", apiKey: str("apiKey") || savedKey, model: str("model"), size: resolveImageSize(item.size) };
  if (!config.apiKey || config.apiKey.length > 4096 || /[\r\n]/.test(config.apiKey)) throw new Error("请填写有效的 GotoCC 图片 API Key");
  if (!config.model || config.model.length > 150 || /[\r\n]/.test(config.model)) throw new Error("请选择图片模型");
  return config;
}
