"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  History,
  LockKeyhole,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import type { BrandTemplateDTO, ProjectSummaryDTO, StyleDTO } from "@/lib/client-types";
import { BrandTemplateDialog } from "./BrandTemplateDialog";
import { ContentMaterialInput } from "./ContentMaterialInput";

export default function HomeScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [usePreparedPlan, setUsePreparedPlan] = useState(true);
  const submitting = useRef(false);
  const [projects, setProjects] = useState<ProjectSummaryDTO[]>([]);
  const [brandTemplates, setBrandTemplates] = useState<BrandTemplateDTO[]>([]);
  const [styles, setStyles] = useState<StyleDTO[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    void fetch("/api/bootstrap")
      .then((res) => res.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        setBrandTemplates(data.brandTemplates ?? []);
        setStyles(data.styles ?? []);
        setReady(Boolean(data.configured));
      })
      .catch(() => setError("未能加载项目配置，请检查服务后刷新。"));
  }, []);

  async function start() {
    if (submitting.current || (!text.trim() && !files.length)) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      let body: FormData | string;
      if (files.length) {
        body = new FormData();
        body.set("requestText", text.trim());
        body.set("brandTemplateId", selectedTemplateId);
        body.set("usePreparedPlan", String(usePreparedPlan));
        for (const file of files) body.append("files", file);
      } else {
        body = JSON.stringify({ requestText: text.trim(), brandTemplateId: selectedTemplateId || undefined });
      }
      const response = await fetch("/api/projects", {
        method: "POST",
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
        body,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || (response.status === 413 ? "资料超过上传上限，请缩小文件后重试。" : "创建失败，请稍后重试。"));
      }
      if (typeof data?.id !== "string") throw new Error("未收到项目编号，请稍后重试。");
      router.push(`/projects/${data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接中断，未能创建项目，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="atelier-home h-dvh overflow-hidden text-[#111b2b]">
      <div className="atelier-orbit" aria-hidden />
      <aside className="atelier-history hidden md:flex">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.18em] text-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#2f80ff]">
              <Sparkles size={14} />
            </span>
            PPT AGENT
          </div>
          <button className="atelier-icon-dark" onClick={() => router.push("/settings")} aria-label="打开设置">
            <Settings size={16} />
          </button>
        </div>

        <button className="atelier-new" disabled={busy} onClick={() => { setText(""); setFiles([]); setUsePreparedPlan(true); setError(""); }}>
          <Plus size={16} />
          新建演示
          <ArrowUpRight className="ml-auto" size={14} />
        </button>

        <div className="mt-8 flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-white/40">
          <History size={13} />
          RECENT WORK
        </div>
        <div className="custom-scroll mt-3 flex-1 space-y-1 overflow-y-auto">
          {projects.map((project, index) => (
            <button
              key={project.id}
              className="atelier-project group"
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              <span className="atelier-project-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-white/88">{project.title}</span>
                <span className="mt-1 block text-[9px] tracking-[0.12em] text-white/36">
                  {project.stage.toUpperCase()} / {project.status.toUpperCase()}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-white/10 pt-4 text-[9px] leading-5 tracking-[0.15em] text-white/30">
          RESEARCH · STORY · VISUAL<br />LOCAL PRESENTATION ENGINE
        </div>
      </aside>

      <main className="relative flex h-full min-w-0 flex-1 flex-col md:ml-[292px]">
        <header className="flex h-[70px] shrink-0 items-center justify-between px-5 md:px-9">
          <div className="text-[10px] font-semibold tracking-[0.2em] text-[#8492a6]">BLUEPRINT ATELIER / 01</div>
          <button className="atelier-icon-light md:hidden" onClick={() => router.push("/settings")} aria-label="打开设置">
            <Settings size={17} />
          </button>
          <div className="hidden items-center gap-2 text-[10px] font-medium text-[#68778c] md:flex">
            <span className={ready ? "status-dot status-dot-ready" : "status-dot"} />
            {ready ? "模型系统已就绪" : "等待模型配置"}
          </div>
        </header>

        <section className="material-home-section relative flex min-h-0 flex-1 items-center overflow-y-auto px-5 pb-10 md:px-[7vw]">
          <div className="atelier-sequence" aria-hidden>01—05</div>
          <div className="w-full max-w-[1040px]">
            <div className="atelier-kicker">
              <span />
              从一句话到一整套可放映叙事
            </div>
            <h1 className="atelier-title">
              把想法<br />
              <span>编排成</span> 演示
            </h1>
            <div className="mt-6 grid items-end gap-6 lg:grid-cols-[minmax(0,700px)_1fr]">
              <div>
                <div className="brand-lock-strip" aria-label="选择品牌模板">
                  <div className="brand-lock-label"><LockKeyhole size={14} /><span>品牌模板</span></div>
                  <div className="brand-lock-options custom-scroll">
                    <button className={!selectedTemplateId ? "active" : ""} onClick={() => setSelectedTemplateId("")}>无模板</button>
                    {brandTemplates.map((template) => (
                      <button
                        key={template.id}
                        className={selectedTemplateId === template.id ? "brand-template-pill active" : "brand-template-pill"}
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        <img src={template.logoUrl} alt="" />
                        <span>{template.name}<small>{template.organizationName}</small></span>
                        <i style={{ background: template.primaryColor }} />
                        <i style={{ background: template.secondaryColor }} />
                        {selectedTemplateId === template.id && <Check size={13} />}
                      </button>
                    ))}
                    <button className="brand-template-add" onClick={() => setTemplateDialogOpen(true)}><Plus size={14} />新建模板</button>
                  </div>
                </div>
                <div className="atelier-composer">
                  <textarea
                    value={text}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="输入主题或制作要求，也可以直接上传资料"
                    aria-label="演示主题"
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void start(); }
                    }}
                  />
                  <ContentMaterialInput
                    files={files}
                    onChange={setFiles}
                    usePreparedPlan={usePreparedPlan}
                    onPreparedPlanChange={setUsePreparedPlan}
                    disabled={busy}
                  />
                  <div className="flex items-center justify-between border-t border-[#dbe3ed] pt-3">
                    <span className="text-[10px] tracking-[0.12em] text-[#91a0b3]">{text.length} CHARACTERS</span>
                    <button className="atelier-start" disabled={busy || (!text.trim() && !files.length)} onClick={() => void start()}>
                      {busy ? (files.length ? "正在上传并读取资料" : "正在建立项目") : "开始编排"}
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <p className="max-w-[250px] text-[12px] leading-6 text-[#738299]">
                调研、需求确认、结构板、初稿与视觉设计在同一条可中断流水线中完成。
              </p>
            </div>
            {!ready && (
              <button className="atelier-notice" onClick={() => router.push("/settings")}>
                三套模型尚未配置完整
                <ArrowUpRight size={14} />
              </button>
            )}
            {error && <p className="mt-4 text-[12px] text-[#c53535]" role="alert">{error}</p>}
          </div>
        </section>
      </main>
      <BrandTemplateDialog
        open={templateDialogOpen}
        styles={styles}
        onClose={() => setTemplateDialogOpen(false)}
        onCreated={(template) => {
          setBrandTemplates((current) => [template, ...current]);
          setSelectedTemplateId(template.id);
        }}
      />
    </div>
  );
}
