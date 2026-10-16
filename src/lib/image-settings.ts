import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_IMAGE_CONFIG, parseImageConfig, type ImageModelConfig, type PublicImageConfig } from "./image-config.ts";

const configPath = () => path.join(process.cwd(), "data", "image-settings.json");
export function getImageSettings(file = configPath()): ImageModelConfig {
  try { return parseImageConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_IMAGE_CONFIG }; throw error; }
}
export function publicImageSettings(config = getImageSettings()): PublicImageConfig {
  const { apiKey, ...rest } = config;
  return { ...rest, hasKey: Boolean(apiKey), configured: Boolean(apiKey && config.model) };
}
export function saveImageSettings(config: ImageModelConfig, file = configPath()) {
  const parsed = parseImageConfig(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(parsed), { mode: 0o600 });
  fs.renameSync(temp, file);
  return publicImageSettings(parsed);
}
export function requireImageSettings(): ImageModelConfig {
  const config = getImageSettings();
  if (!publicImageSettings(config).configured) throw new Error("请先在设置中保存 GotoCC 图片模型配置");
  return config;
}
