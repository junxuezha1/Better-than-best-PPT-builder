"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ProjectDTO } from "@/lib/client-types";
import type { ThemeSelection, ThemeAsset } from "@/lib/theme-catalog";

export function ThemeChooser({ project, selection, onChange, onBusy }: {
  project: ProjectDTO;
  selection: ThemeSelection | null;
  onChange: (selection: ThemeSelection | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const generation = project.backgroundGeneration;
  const [assets, setAssets] = useState<ThemeAsset[]>(project.designTheme?.assets ?? []);
  const [uploading, setUploading] = useState<"cover" | "body" | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [brief, setBrief] = useState(generation?.brief ?? "");
  const [coverPrompt, setCoverPrompt] = useState(generation?.plan?.coverPrompt ?? "");
  const [bodyPrompt, setBodyPrompt] = useState(generation?.plan?.bodyPrompt ?? "");
  const [exact, setExact] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const roleRef = useRef<"cover" | "body">("cover");
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const busy = requesting || Boolean(uploading) || ["planning", "generating_cover", "generating_body"].includes(generation?.status ?? "");
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { setAssets(project.designTheme?.assets ?? []); }, [project.id, project.designTheme?.assets]);
  useEffect(() => {
    if (generation?.plan) { setCoverPrompt(generation.plan.coverPrompt); setBodyPrompt(generation.plan.bodyPrompt); }
    if (generation?.status === "ready" && generation.candidate && generation.updatedAt > (project.designTheme?.updatedAt ?? "")) onChangeRef.current(generation.candidate);
  // A new generation revision updates the candidate, unrelated SSE updates do not reset edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.updatedAt]);
  const coverPage = project.pages.find((p) => p.pageType === "cover");
  const bodyPage = project.pages.find((p) => p.pageType === "content");
  const canExact = Boolean(selection && project.designTheme?.selection?.themeId === selection.themeId && coverPage?.designSvg && bodyPage?.designSvg);
  const preview = (role: "cover" | "body") => {
    if (!selection) return "";
    const params = new URLSearchParams({ themeId: selection.themeId, coverAssetId: selection.coverAssetId, bodyAssetId: selection.bodyAssetId, intensity: String(selection.intensity), role, v: project.updatedAt });
    if (exact && canExact) { params.set("exact", "true"); params.set("pageId", (role === "cover" ? coverPage! : bodyPage!).id); }
    return `/api/projects/${project.id}/theme?${params}`;
  };
  async function generate(mode: "plan" | "generate" | "retry") {
    setRequesting(true); setError("");
    try {
      const res = await fetch(`/api/projects/${project.id}/theme/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, brief, reusePlan: Boolean(generation?.plan && generation.brief === brief), ...(coverPrompt && bodyPrompt ? { coverPrompt, bodyPrompt } : {}) }),
      });
      if (!res.ok) { const payload = await res.json(); throw new Error(payload.error || "背景生成未能开始"); }
    } catch (err) { setError(err instanceof Error ? err.message : "背景生成未能开始"); }
    finally { setRequesting(false); }
  }
  async function upload(file: File) {
    const role = roleRef.current;
    if (file.size > 10 * 1024 * 1024) { setError("背景图片最大 10MB"); return; }
    setUploading(role); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`/api/projects/${project.id}/theme`, { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "背景上传失败");
      setAssets(payload.designTheme.assets);
      const current = selectionRef.current;
      if (current) onChange({ ...current, [role === "cover" ? "coverAssetId" : "bodyAssetId"]: payload.asset.id });
    } catch (err) { setError(err instanceof Error ? err.message : "背景上传失败，请重试"); }
    finally { setUploading(null); }
  }
  const progress = generation?.status === "planning" ? "正在提炼视觉概念与完整提示词" : generation?.status === "generating_cover" ? "正在生成封面背景 · 1 / 2" : "正在生成正文背景 · 2 / 2";
  return <section className="theme-chooser" aria-label="AI 背景工作室">
    <div className="theme-heading"><div><h4>为这份演示创造一个视觉世界</h4><p>从当前内容出发，生成专属的材质、光影与空间。</p></div>
      {selection && <button type="button" disabled={busy} className="theme-text-button" onClick={() => onChange(null)}><RotateCcw size={14} />移除背景</button>}
    </div>
    <label className="background-brief">视觉要求 <span>可留空，由 AI 自主策划</span>
      <textarea aria-label="视觉要求" value={brief} disabled={busy} maxLength={5000} onChange={e => setBrief(e.target.value)} placeholder="描述你想让观众感受到什么，或指定材质、色调与画面气质。AI 会结合这份演示规划完整构图。" />
    </label>
    <div className="background-generation-actions">
      <button type="button" disabled={busy || project.status === "running"} onClick={() => void generate("plan")}>{generation?.plan ? "重新规划提示词" : "先看完整提示词"}</button>
      <button type="button" className="background-generate-primary" disabled={busy || project.status === "running" || !project.imageGenerationConfigured} onClick={() => void generate("generate")}><Sparkles size={15} />{selection ? "重新生成两张背景" : "AI 生成两张背景"}</button>
    </div>
    <p className="theme-preview-note">{project.imageGenerationConfigured ? "生成封面与正文各一张，消耗 GotoCC 余额；提示词规划只调用文本模型。" : <>先在<Link href="/settings">设置中配置 GotoCC 图片模型</Link>。也可先生成并查看完整提示词。</>}</p>
    {busy && <div className="background-progress" role="status"><LoaderCircle size={18} className="animate-spin" /><span>{requesting ? "正在提交" : uploading ? "正在保存背景" : progress}</span><button type="button" onClick={() => { void fetch(`/api/projects/${project.id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "cancel" }) }); }}>暂停</button></div>}
    {generation?.error && <div className="theme-error" role="alert"><p>{generation.error}</p>
      {!busy && ["failed", "interrupted"].includes(generation.status) && <button type="button" disabled={!project.imageGenerationConfigured || project.status === "running"} onClick={() => void generate("retry")}>重试未完成部分（图片可能再次计费）</button>}
    </div>}
    {generation?.plan && <details className="background-prompt-editor">
      <summary>{generation.plan.name} · 查看 / 编辑完整提示词</summary>
      <p>{generation.plan.concept}</p>
      <dl><div><dt>视觉母题</dt><dd>{generation.plan.visualMotif}</dd></div><div><dt>材质</dt><dd>{generation.plan.materials}</dd></div><div><dt>光影与空间</dt><dd>{generation.plan.lighting} {generation.plan.depth}</dd></div></dl>
      <label>封面图片提示词<textarea aria-label="封面图片提示词" value={coverPrompt} disabled={busy} maxLength={10000} onChange={e => setCoverPrompt(e.target.value)} /></label>
      <label>正文图片提示词<textarea aria-label="正文图片提示词" value={bodyPrompt} disabled={busy} maxLength={10000} onChange={e => setBodyPrompt(e.target.value)} /></label>
      <p>编辑后点击“AI 生成两张背景”使用。整套材质、配色与文字安全区规则会一并发送给图片模型。</p>
    </details>}
    {selection ? <>
      <div className="theme-preview-label"><strong>{exact && canExact ? "现有设计 · 背景替换预览" : "当前内容 · 新背景样张"}</strong>
        {canExact && <label><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />查看现有设计</label>}
      </div>
      <div className="theme-proofs">
        {(["cover", "body"] as const).map((role) => <figure key={role}>
          <ThemePreview src={preview(role)} label={role === "cover" ? "封面预览" : "正文预览"} />
          <figcaption>{role === "cover" ? "封面 · 章节 · 结束页" : "正文 · 目录"}</figcaption>
        </figure>)}
      </div>
      <p className="theme-preview-note">{exact && canExact ? "仅替换背景会保留这里显示的原有文字与排版。" : "样张用于比较背景、字色和内容搭配；最终版式会按每页内容设计。"}</p>
      <details className="background-adjustments"><summary>调整背景强度 / 使用自己的图片</summary>
        <div className="theme-background-controls">
          <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
          {(["cover", "body"] as const).map((role) => <div className="theme-asset-control" key={role}>
            <label htmlFor={`theme-${role}`}>{role === "cover" ? "封面背景" : "正文背景"}</label>
            <div><select id={`theme-${role}`} disabled={busy} value={role === "cover" ? selection.coverAssetId : selection.bodyAssetId}
              onChange={(e) => onChange({ ...selection, [role === "cover" ? "coverAssetId" : "bodyAssetId"]: e.target.value })}>
              {!selection.definition && <option value="">原有背景</option>}{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select><button type="button" disabled={busy} onClick={() => { roleRef.current = role; fileInput.current?.click(); }} aria-label={`上传${role === "cover" ? "封面" : "正文"}背景`}><ImagePlus size={16} />上传</button></div>
          </div>)}
          <label className="theme-intensity">背景强度 <output>{Math.round(selection.intensity * 100)}%</output>
            <input type="range" min="0" max="1" step="0.1" value={selection.intensity} disabled={busy} onChange={(e) => onChange({ ...selection, intensity: Number(e.target.value) })} /></label>
        </div>
        <p className="theme-preview-note">PNG、JPEG、WebP，单张最多 10MB。背景按 16:9 居中裁切；文字不清晰时可降低背景强度。</p>
      </details>
    </> : <div className="background-empty"><span>封面主视觉 + 正文氛围</span><p>先生成背景，再用当前演示内容预览。每份演示独立策划。</p></div>}
    {error && <p role="alert" className="theme-error">{error}</p>}
  </section>;
}

function ThemePreview({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <div className="theme-preview-error" role="status">预览暂不可用，请重新打开背景面板</div>
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt={label} onError={() => setFailed(true)} />;
}
