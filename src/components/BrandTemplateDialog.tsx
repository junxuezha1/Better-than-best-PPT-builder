"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ImageUp, LoaderCircle, School, X } from "lucide-react";
import type { BrandTemplateDTO, StyleDTO } from "@/lib/client-types";

export function BrandTemplateDialog({
  open,
  styles,
  onClose,
  onCreated,
}: {
  open: boolean;
  styles: StyleDTO[];
  onClose: () => void;
  onCreated: (template: BrandTemplateDTO) => void;
}) {
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationType, setOrganizationType] = useState<"company" | "school" | "other">("company");
  const [baseStyleId, setBaseStyleId] = useState("brand-clean");
  const [primaryColor, setPrimaryColor] = useState("#1664FF");
  const [secondaryColor, setSecondaryColor] = useState("#0F2C59");
  const [logos, setLogos] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!logos.length) {
      setPreviewUrls([]);
      return;
    }
    const urls = logos.map((logo) => URL.createObjectURL(logo));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [logos]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function save() {
    if (!name.trim() || !organizationName.trim() || !logos.length) {
      setError("请填写模板名称、组织名称并选择 Logo 变体");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("name", name.trim());
    form.set("organizationName", organizationName.trim());
    form.set("organizationType", organizationType);
    form.set("baseStyleId", baseStyleId);
    form.set("primaryColor", primaryColor);
    form.set("secondaryColor", secondaryColor);
    logos.forEach((logo) => form.append("logos", logo));
    const response = await fetch("/api/templates", { method: "POST", body: form });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "品牌模板创建失败");
      return;
    }
    onCreated(data as BrandTemplateDTO);
    onClose();
  }

  return (
    <div className="brand-dialog-backdrop" role="dialog" aria-modal="true" aria-label="新建品牌模板">
      <section className="brand-dialog-shell">
        <header className="brand-dialog-header">
          <div>
            <span>BRAND SYSTEM</span>
            <h2>固化一套品牌模板</h2>
            <p>可保存横版、竖版、方版三种 SVG，系统按页型调用，文件内容保持原样。</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="brand-dialog-grid">
          <div className="brand-logo-stage">
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept=".svg,.png,image/svg+xml,image/png"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []).slice(0, 3);
                setLogos(selected);
                setError(selected.length ? "" : "请选择 Logo 变体");
              }}
            />
            <button type="button" onClick={() => inputRef.current?.click()}>
              {previewUrls.length ? (
                <span className="brand-asset-preview-grid">
                  {previewUrls.map((url, index) => (
                    <span key={url} className="brand-asset-preview">
                      <img src={url} alt={`Logo 变体 ${index + 1}`} />
                      <small>变体 {index + 1} · 原图保留</small>
                    </span>
                  ))}
                </span>
              ) : (
                <span><ImageUp size={24} />选择 Logo 变体<small>最多 3 份 SVG 或透明 PNG，每份最大 3MB</small></span>
              )}
            </button>
            <div className="brand-preview-lock">
              <span style={{ background: primaryColor }} />
              <span style={{ background: secondaryColor }} />
              <strong>{organizationName || "组织名称"}</strong>
              <Check size={14} />
            </div>
          </div>

          <div className="brand-form">
            <label>模板名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：南山大学标准汇报" /></label>
            <label>组织名称<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="公司或学校全称" /></label>
            <fieldset>
              <legend>组织类型</legend>
              <div className="brand-segmented">
                <button type="button" className={organizationType === "company" ? "active" : ""} onClick={() => setOrganizationType("company")}><Building2 size={14} />公司</button>
                <button type="button" className={organizationType === "school" ? "active" : ""} onClick={() => setOrganizationType("school")}><School size={14} />学校</button>
                <button type="button" className={organizationType === "other" ? "active" : ""} onClick={() => setOrganizationType("other")}>其他</button>
              </div>
            </fieldset>
            <label>基础风格
              <select value={baseStyleId} onChange={(event) => setBaseStyleId(event.target.value)}>
                {styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
              </select>
            </label>
            <div className="brand-color-grid">
              <label>品牌主色<span><input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())} /><code>{primaryColor}</code></span></label>
              <label>品牌辅色<span><input type="color" value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value.toUpperCase())} /><code>{secondaryColor}</code></span></label>
            </div>
          </div>
        </div>

        <footer className="brand-dialog-footer">
          <span>{error}</span>
          <button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />}
            保存并选用
          </button>
        </footer>
      </section>
    </div>
  );
}
