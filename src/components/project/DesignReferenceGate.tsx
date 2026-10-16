"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FileImage,
  FileUp,
  LoaderCircle,
  Palette,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import type { ProjectDTO } from "@/lib/client-types";
import { ThemeChooser } from "./ThemeChooser";
import { getDesignTheme } from "@/lib/theme-catalog";
import type { ThemeSelection } from "@/lib/theme-catalog";

export interface DesignConfirmation {
  mode: "preset" | "upload";
  styleId: string;
  colorPreference: string;
  theme?: ThemeSelection | null;
  backgroundOnly?: boolean;
}

export function DesignReferenceGate({
  project,
  open,
  onClose,
  onUpload,
  onConfirm,
}: {
  project: ProjectDTO;
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<boolean>;
  onConfirm: (input: DesignConfirmation) => void;
}) {
  const initialMode = project.designReference.mode === "brand" ? "preset" : project.designReference.mode;
  const [mode, setMode] = useState<"preset" | "upload">(initialMode);
  const [styleId, setStyleId] = useState(project.designReference.styleId || project.style.id);
  const [colorPreference, setColorPreference] = useState(project.designReference.colorPreference);
  const [uploading, setUploading] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [allowBasic, setAllowBasic] = useState(false);
  const [theme, setTheme] = useState<ThemeSelection | null>(project.designTheme?.selection ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const generated = project.backgroundGeneration;
    const pending = generated?.status === "ready" && generated.updatedAt > (project.designTheme?.updatedAt ?? "") ? generated.candidate : null;
    setTheme(pending ?? project.designTheme?.selection ?? null);
    setMode(project.designReference.mode === "brand" ? "preset" : project.designReference.mode);
    setStyleId(project.designReference.styleId || project.style.id);
    setColorPreference(project.designReference.colorPreference);
  // Reset when opening or receiving a confirmed revision, not on every SSE snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id, project.designReference.updatedAt, project.designTheme?.updatedAt]);

  const draftReady = project.pages.filter((page) => page.draftStatus === "ready").length;
  const hasDesign = project.pages.some((page) => page.designSvg);
  const selectedStyle = project.styles.find((style) => style.id === styleId) ?? project.style;
  const uploadReady = ["ready", "confirmed"].includes(project.designReference.status) && Boolean(project.designReference.profile);
  const canConfirm = (mode === "preset" ? Boolean(theme || allowBasic) : uploadReady) && !uploading && !backgroundBusy;
  const selectedTheme = theme ? getDesignTheme(theme.themeId, theme.definition) : null;
  const canReplace = Boolean(theme && project.designTheme?.selection?.themeId === theme.themeId && project.status !== "running" && project.pages.some(page => page.designStatus === "ready"));

  if (!open) return null;
  return (
    <div className="reference-gate-backdrop" role="dialog" aria-modal="true" aria-label="确认设计参考">
      <div className="reference-gate-shell">
        <div className="reference-gate-rail">
          <div>
            <div className="reference-gate-index">FINAL ART DIRECTION</div>
            <h2>{hasDesign ? <>调整背景，<br />预览整套效果。</> : <>为每份演示，<br />创造专属视觉。</>}</h2>
            <p>用当前内容比较封面与正文。背景、字色和版式一起确定，事实与引用保持原意。</p>
          </div>
          <div className="reference-gate-progress">
            <div><span>01</span><Check size={14} />内容与结构</div>
            <div><span>02</span><Check size={14} />{draftReady} 页初稿</div>
            <div className="active"><span>03</span><Palette size={14} />设计参考</div>
            <div><span>04</span><Sparkles size={14} />最终设计</div>
          </div>
          <div className="reference-gate-note">{hasDesign ? "更换主题会重新设计；同主题可仅替换背景，保留现有文字与排版。" : "确认后，Agent 才会开始逐页完成最终设计。"}</div>
        </div>

        <div className="reference-gate-main">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-[0.16em] text-[#2f80ff]">DESIGN REFERENCE</div>
              <h3 className="mt-2 text-[25px] font-semibold tracking-[-0.045em]">让整套演示有自己的视觉语言</h3>
              <p className="mt-2 text-[11px] text-[#7b899b]">让 AI 按内容生成专属背景，或沿用参考演示的视觉风格。</p>
            </div>
            <button className="reference-close" onClick={onClose} aria-label="暂时关闭"><X size={17} /></button>
          </div>

          <div className="reference-mode-switch">
            <button className={mode === "preset" ? "active" : ""} onClick={() => setMode("preset")}>
              <Palette size={15} /><span>AI 原创背景<small>完整提示词与专属画面</small></span>
            </button>
            <button className={mode === "upload" ? "active" : ""} onClick={() => { setMode("upload"); setTheme(null); }}>
              <FileUp size={15} /><span>上传参考文件<small>PPT / PPTX / PDF</small></span>
            </button>
          </div>

          <div className="custom-scroll min-h-0 flex-1 overflow-y-auto pr-1">
            {mode === "preset" && <ThemeChooser project={project} selection={theme} onBusy={setBackgroundBusy} onChange={(next) => {
              setTheme(next);
              if (next) { setMode("preset"); setStyleId(getDesignTheme(next.themeId, next.definition).baseStyleId); }
            }} />}
            {mode === "preset" && !theme ? (
              <details className="background-adjustments"><summary>仅使用基础配色，不生成背景</summary><div className="reference-style-grid">
                {project.styles.map((style) => (
                  <button
                    key={style.id}
                    className={styleId === style.id ? "reference-style-card active" : "reference-style-card"}
                    onClick={() => { setStyleId(style.id); setAllowBasic(true); }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[12px] font-semibold">{style.name}</div>
                        <div className="mt-0.5 text-[8px] tracking-[0.08em] text-[#8a96a6]">{style.nameEn}</div>
                      </div>
                      {styleId === style.id && <span className="style-selected"><Check size={11} /></span>}
                    </div>
                    <div className="style-palette-row">
                      {style.palette && [style.palette.bg, style.palette.surface, style.palette.accent, style.palette.accent2, style.palette.text].map((color) => (
                        <span key={color} style={{ background: color }} />
                      ))}
                    </div>
                    <p>{style.philosophy}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {style.mood.slice(0, 3).map((mood) => <span className="style-mood" key={mood}>{mood}</span>)}
                    </div>
                  </button>
                ))}
                <label className="reference-color-note">
                  <span>颜色补充偏好</span>
                  <input
                    value={colorPreference}
                    onChange={(event) => setColorPreference(event.target.value)}
                    placeholder={`例如：保留 ${selectedStyle.name}，但降低蓝色饱和度`}
                  />
                </label>
              </div></details>
            ) : mode === "upload" ? (
              <div className="reference-upload-panel">
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept=".ppt,.pptx,.pdf,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    await onUpload(file);
                    setUploading(false);
                    event.target.value = "";
                  }}
                />
                <button className="reference-drop-zone" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <span className="reference-file-icon">{uploading ? <LoaderCircle className="animate-spin" size={22} /> : <FileImage size={22} />}</span>
                  <strong>{uploading ? "正在保存参考文件" : project.designReference.fileName || "选择一份参考演示"}</strong>
                  <span>最大 50MB · 最多分析 40 页 · 文件只保存在本机</span>
                </button>

                <ReferenceAnalysis project={project} />
              </div>
            ) : null}
            {theme && <label className="reference-color-note"><span>设计补充</span><input value={colorPreference} onChange={event => setColorPreference(event.target.value)} placeholder="例如：标题更醒目，减少卡片嵌套" /></label>}
          </div>

          <div className="reference-gate-actions">
            <div>
              <span className="block text-[9px] text-[#8a97a8]">即将采用</span>
              <strong className="mt-0.5 block text-[11px]">
                {selectedTheme?.name || (mode === "preset" ? allowBasic ? selectedStyle.name : "等待生成背景" : project.designReference.profile?.name || "等待分析参考稿")}
              </strong>
            </div>
            {canReplace && <button className="theme-replace-button" disabled={!canConfirm} onClick={() => onConfirm({ mode, styleId, colorPreference, theme, backgroundOnly: true })}>仅替换整套背景</button>}
            <button
              disabled={!canConfirm || project.designReference.status === "processing"}
              onClick={() => onConfirm({ mode, styleId, colorPreference, theme })}
            >
              {hasDesign ? "应用主题并重新设计" : "确认并开始最终设计"}<ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferenceAnalysis({ project }: { project: ProjectDTO }) {
  const reference = project.designReference;
  const profile = reference.profile;
  if (reference.status === "processing") {
    return (
      <div className="reference-analysis processing">
        <LoaderCircle size={18} className="animate-spin" />
        <div><strong>正在理解参考稿</strong><span>提取代表页面的颜色、图文关系与版式规律</span></div>
      </div>
    );
  }
  if (reference.status === "failed") {
    return <div className="reference-analysis failed"><X size={17} /><div><strong>分析失败</strong><span>{reference.error}</span></div></div>;
  }
  if (!profile) {
    return (
      <div className="reference-analysis waiting">
        <ScanSearch size={18} />
        <div><strong>分析内容</strong><span>配色、字阶、卡片、图表、配图位置与页面节奏</span></div>
      </div>
    );
  }
  return (
    <div className="reference-profile-card">
      <div className="flex items-start justify-between">
        <div><div className="text-[12px] font-semibold">{profile.name}</div><p>{profile.summary}</p></div>
        <span>{reference.pageCount} 页</span>
      </div>
      <div className="reference-profile-palette">
        {profile.palette.map((color) => <span key={color} style={{ background: color }} title={color} />)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ProfileFact label="标题系统" value={profile.titleSystem} />
        <ProfileFact label="图片处理" value={profile.imageTreatment} />
        <ProfileFact label="卡片语言" value={profile.cardSystem} />
        <ProfileFact label="信息密度" value={profile.density} />
      </div>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="reference-profile-fact"><span>{label}</span><p>{value || "已从参考页提取"}</p></div>;
}
