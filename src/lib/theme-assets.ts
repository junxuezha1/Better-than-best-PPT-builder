import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { getDesignTheme, parseThemeSelection, themeRole, isGeneratedThemeId } from "./theme-catalog.ts";
import type { DesignThemeState, ThemeAsset, ThemeSelection, ThemeDefinition } from "./theme-catalog.ts";
import type { PageType } from "./types.ts";

function directory(projectId: string, root = path.join(process.cwd(), "data", "artifacts")) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("项目 ID 不合法");
  return path.join(root, projectId, "themes");
}
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}
function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function getDesignThemeState(projectId: string, root?: string): DesignThemeState {
  const dir = directory(projectId, root);
  const stored = readJson<{ selection: unknown; updatedAt: string }>(path.join(dir, "state.json"));
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const assets = files.filter((name) => /^bg_[a-f0-9-]{36}\.json$/.test(name))
    .map((name) => readJson<ThemeAsset>(path.join(dir, name)))
    .filter((item): item is ThemeAsset => Boolean(item)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { selection: stored ? parseThemeSelection(stored.selection) : null, assets, updatedAt: stored?.updatedAt ?? "" };
}
export function validateThemeAssets(projectId: string, selection: ThemeSelection | null, root?: string) {
  if (!selection) return;
  parseThemeSelection(selection);
  if (isGeneratedThemeId(selection.themeId)) {
    const definition = readGeneratedTheme(projectId, selection.themeId, root);
    if (!definition || JSON.stringify(parseThemeSelection({ ...selection, definition })) !== JSON.stringify(parseThemeSelection(selection))) throw new Error("AI 视觉方案不属于此项目或已被修改");
  }
  for (const id of [selection.coverAssetId, selection.bodyAssetId].filter(Boolean)) readThemeUpload(projectId, id, root);
}
export function saveDesignTheme(projectId: string, selection: ThemeSelection | null, root?: string) {
  validateThemeAssets(projectId, selection, root);
  writeJson(path.join(directory(projectId, root), "state.json"), { selection, updatedAt: new Date().toISOString() });
}
export function readThemeUpload(projectId: string, assetId: string, root?: string): Buffer {
  if (!/^bg_[a-f0-9-]{36}$/.test(assetId)) throw new Error("背景图片标识不合法");
  const dir = directory(projectId, root);
  if (!readJson<ThemeAsset>(path.join(dir, `${assetId}.json`))) throw new Error("背景图片不属于此项目或已不可用");
  return fs.readFileSync(path.join(dir, `${assetId}.jpg`));
}
export async function saveThemeUpload(projectId: string, name: string, bytes: Buffer, root?: string): Promise<ThemeAsset> {
  const dir = directory(projectId, root);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("背景图片最大 10MB");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!png && !jpg && !webp) throw new Error("背景只支持 PNG、JPEG 或 WebP 图片");
  if (getDesignThemeState(projectId, root).assets.length >= 20) throw new Error("每个项目最多上传 20 张背景，请使用已上传图片");
  let normalized: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "error" });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1) throw new Error("animated");
    normalized = await image.rotate().resize(1280, 720, { fit: "cover", position: "centre" }).flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch { throw new Error("背景图片无法读取：请使用静态图片，像素不超过 2400 万"); }
  // Recheck after decoding, before the synchronous commit, for concurrent uploads.
  if (getDesignThemeState(projectId, root).assets.length >= 20) throw new Error("每个项目最多上传 20 张背景");
  const asset = { id: `bg_${crypto.randomUUID()}`, name: name.replace(/[\u0000-\u001f]/g, "").slice(0, 120), createdAt: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${asset.id}.jpg`), normalized, { flag: "wx" });
  writeJson(path.join(dir, `${asset.id}.json`), asset);
  return asset;
}

export function resolveThemeBackground(projectId: string, selection: ThemeSelection, pageType: PageType, root?: string): Buffer {
  getDesignTheme(selection.themeId, selection.definition);
  const role = themeRole(pageType);
  const customId = role === "cover" ? selection.coverAssetId : selection.bodyAssetId;
  return customId ? readThemeUpload(projectId, customId, root)
    : fs.readFileSync(path.join(process.cwd(), "public", "themes", selection.themeId, `${role}.jpg`));
}

export function saveGeneratedTheme(projectId: string, definition: ThemeDefinition, root?: string) {
  if (!isGeneratedThemeId(definition.id)) throw new Error("AI 视觉方案标识不合法");
  writeJson(path.join(directory(projectId, root), `${definition.id}.json`), definition);
}
export function readGeneratedTheme(projectId: string, themeId: string, root?: string): ThemeDefinition | undefined {
  if (!isGeneratedThemeId(themeId)) return undefined;
  return readJson<ThemeDefinition>(path.join(directory(projectId, root), `${themeId}.json`)) ?? undefined;
}
