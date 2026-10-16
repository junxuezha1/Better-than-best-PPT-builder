"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileArchive, FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";

const ACCEPTED_EXTENSIONS = new Set(["md", "txt", "json", "pdf", "docx", "png", "jpg", "jpeg", "webp", "zip"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function extension(file: File) {
  return file.name.split(".").at(-1)?.toLowerCase() || "";
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const isImage = IMAGE_EXTENSIONS.has(extension(file));

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setFailed(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  if (isImage && url && !failed) {
    return <img src={url} alt={`${file.name} 预览`} onError={() => setFailed(true)} />;
  }
  if (isImage) return <ImageIcon size={19} aria-hidden />;
  if (extension(file) === "zip") return <FileArchive size={19} aria-hidden />;
  return <FileText size={19} aria-hidden />;
}

export function ContentMaterialInput({
  files,
  onChange,
  usePreparedPlan,
  onPreparedPlanChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  usePreparedPlan: boolean;
  onPreparedPlanChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const descriptionId = useId();
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  useEffect(() => {
    if (!files.length) setError("");
  }, [files.length]);

  function addFiles(incoming: File[]) {
    if (disabled || !incoming.length) return;
    const known = new Set(files.map(fileKey));
    const added = incoming.filter((file) => {
      const key = fileKey(file);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    const invalid = added.find((file) => !ACCEPTED_EXTENSIONS.has(extension(file)));
    if (invalid) {
      setError(`不支持「${invalid.name}」。请选择下方列出的图片、文档或 ZIP。`);
      return;
    }
    const oversized = added.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`「${oversized.name}」超过单个文件 50 MB 的上限。`);
      return;
    }
    const combined = [...files, ...added];
    if (combined.length > MAX_FILES) {
      setError("一次最多选择 20 个文件；较多资料可以整理成 ZIP。 ");
      return;
    }
    if (combined.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
      setError("所选文件合计超过 100 MB，请移除部分资料后再添加。");
      return;
    }
    setError("");
    onChange(combined);
  }

  return (
    <section
      className={`content-material-input${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      aria-label="内容资料"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".md,.txt,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp,.zip"
        aria-label="添加内容资料"
        disabled={disabled}
        hidden
        onChange={(event) => {
          addFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      <div className="content-material-toolbar">
        <button type="button" disabled={disabled} aria-describedby={descriptionId} onClick={() => inputRef.current?.click()}>
          <Paperclip size={15} aria-hidden />
          {files.length ? "继续添加资料" : "添加图片、文档或 ZIP"}
        </button>
        <span>{files.length ? `${files.length} 个文件 · ${formatSize(totalBytes)}` : "也可以拖到这里"}</span>
        {files.length > 0 && (
          <button type="button" className="content-material-clear" disabled={disabled} onClick={() => { onChange([]); setError(""); }}>
            清空
          </button>
        )}
      </div>
      {files.length > 0 && (
        <ul className="content-material-files custom-scroll" aria-label="待上传文件">
          {files.map((file, index) => (
            <li key={fileKey(file)}>
              <span className="content-material-preview"><FilePreview file={file} /></span>
              <span className="content-material-file-label">
                <strong title={file.name}>{file.name}</strong>
                <small>{extension(file).toUpperCase()} · {formatSize(file.size)}</small>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`移除 ${file.name}`}
                onClick={() => { onChange(files.filter((_, itemIndex) => itemIndex !== index)); setError(""); }}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id={descriptionId} className="content-material-description">
        资料用于内容、引用与配图；视觉风格可在后续设计参考中选择。
        <span>支持 PNG / JPG / WebP、MD / TXT / JSON、PDF / DOCX、ZIP。最多 20 个，单个 50 MB，合计 100 MB。</span>
      </p>
      <label className="content-material-plan">
        <input type="checkbox" checked={usePreparedPlan} disabled={disabled} onChange={(event) => onPreparedPlanChange(event.target.checked)} />
        <span>按资料包中的逐页方案制作（如有）<small>保留已有页序、文案和讲稿；未找到逐页方案时，按资料生成大纲。</small></span>
      </label>
      {error && <p className="content-material-error" role="alert">{error}</p>}
    </section>
  );
}
