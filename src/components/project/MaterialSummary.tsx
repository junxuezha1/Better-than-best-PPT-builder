"use client";

import { ChevronDown, FileText, Image as ImageIcon, Paperclip, TriangleAlert } from "lucide-react";
import type { ContentMaterialsDTO } from "@/lib/client-types";

export function MaterialSummary({ materials }: { materials?: ContentMaterialsDTO | null }) {
  if (!materials) return null;
  return (
    <details className="content-material-summary">
      <summary>
        <Paperclip size={15} aria-hidden />
        <span><strong>内容资料</strong><small>{materials.fileCount} 个文件{materials.preparedSlideCount ? ` · ${materials.preparedSlideCount} 页方案` : ""}</small></span>
        {materials.warnings.length > 0 && <span className="content-material-warning-count" aria-label={`${materials.warnings.length} 项处理提示`}>{materials.warnings.length}</span>}
        <ChevronDown size={14} className="content-material-summary-chevron" aria-hidden />
      </summary>
      <div className="content-material-summary-body">
        <div className="content-material-counts">
          <span><FileText size={13} aria-hidden />文档 {materials.documentCount}</span>
          <span><ImageIcon size={13} aria-hidden />图片 {materials.imageCount}</span>
        </div>
        {materials.uploads.length > 0 && <ul className="content-material-upload-names">{materials.uploads.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}</ul>}
        {materials.preparedSlideCount ? <p>已读取逐页方案，页面内容和顺序将进入制作流程。</p> : <p>资料将用于内容与配图，视觉风格仍在设计参考中确认。</p>}
        {materials.warnings.length > 0 && (
          <div className="content-material-warnings">
            <strong><TriangleAlert size={13} aria-hidden />资料处理提示</strong>
            <ul>{materials.warnings.map((warning, index) => <li key={`${warning}:${index}`}>{warning}</li>)}</ul>
          </div>
        )}
      </div>
    </details>
  );
}
