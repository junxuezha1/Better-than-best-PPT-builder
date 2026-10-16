"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { PptxExportMode } from "../../lib/export-types";
import { ProjectIcon as Icon } from "./ProjectIcon";
import { pptxDownloadMessage, requestPptxDownload } from "./export-download";

const MODES = [
  { mode: "editable", label: "可编辑 PPTX（推荐）", description: "修改文字、形状和图片；复杂效果保留为图片", icon: "edit" },
  { mode: "fidelity", label: "高保真 PPTX", description: "完整保留页面视觉，适合直接放映", icon: "palette" },
] as const;

export function ExportMenu({ projectId, ready }: { projectId: string; ready: boolean }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestRef = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const urls = downloadUrls.current;
    return () => {
      requestRef.current?.abort();
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!ready) setOpen(false);
  }, [ready]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0
        : event.key === "End" ? MODES.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + MODES.length) % MODES.length;
      itemRefs.current[next]?.focus();
    }
  }

  async function download(mode: PptxExportMode) {
    if (!ready || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    closeMenu(true);
    setNotice(null);
    setBusy(true);
    try {
      const result = await requestPptxDownload(projectId, mode, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.hidden = true;
      document.body.append(link);
      try { link.click(); } finally {
        link.remove();
        // Give the browser time to consume the URL, and release it on unmount too.
        downloadUrls.current.set(url, setTimeout(() => {
          URL.revokeObjectURL(url);
          downloadUrls.current.delete(url);
        }, 1000));
      }
      setNotice({ text: pptxDownloadMessage(result, mode), error: false });
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice({
          text: error instanceof Error && error.name !== "TypeError"
            ? error.message : "导出连接失败，请检查网络后重试",
          error: true,
        });
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className="primary-button"
        disabled={!ready}
        aria-disabled={busy || undefined}
        aria-busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={busy ? "正在导出 PPTX" : "导出 PPTX"}
        title={!ready ? "全部设计稿完成后才能导出" : undefined}
        onClick={() => {
          if (busy) return;
          setNotice(null);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && ready && !busy) {
            event.preventDefault();
            setNotice(null);
            setOpen(true);
          }
        }}
      >
        <Icon name="download" size={14} />
        <span className="hidden sm:inline">{busy ? "导出中…" : "导出"}</span>
        {!busy && <Icon name="down" size={12} />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="PPTX 导出模式"
          className="absolute right-0 top-full z-50 mt-2 w-[310px] max-w-[calc(100vw-24px)] rounded-[16px] border border-[#dce5f0] bg-white p-1.5 shadow-[0_16px_48px_rgba(23,36,58,0.18)]"
          onKeyDown={onMenuKeyDown}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) closeMenu();
          }}
        >
          {MODES.map((item, index) => (
            <button
              key={item.mode}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="flex w-full items-start gap-3 rounded-[11px] px-3 py-3 text-left hover:bg-[#f1f6ff] focus:bg-[#f1f6ff]"
              onClick={() => void download(item.mode)}
            >
              <Icon name={item.icon} size={16} className="mt-0.5 shrink-0 text-[#2f80ff]" />
              <span>
                <strong className="block text-[12px] font-semibold text-[#17243a]">{item.label}</strong>
                <span className="mt-1 block text-[10px] leading-4 text-[#7b899b]">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-[310px] max-w-[calc(100vw-24px)] items-start gap-2 rounded-[13px] border border-[#dce5f0] bg-white p-3 shadow-[0_12px_36px_rgba(23,36,58,0.14)]"
        >
          <p role={notice.error ? "alert" : "status"} className={`flex-1 text-[11px] leading-5 ${notice.error ? "text-red-700" : "text-[#526176]"}`}>
            {notice.text}
          </p>
          <button type="button" onClick={() => setNotice(null)} className="rounded p-1 text-[#8290a3] hover:bg-[#f1f6ff]" aria-label="关闭导出提示">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
