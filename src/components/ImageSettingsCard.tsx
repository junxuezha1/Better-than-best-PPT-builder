"use client";

import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { Image, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { DEFAULT_IMAGE_CONFIG, type PublicImageConfig } from "@/lib/image-config";

export interface ImageSettingsHandle { saveIfChanged: () => Promise<void> }

export function ImageSettingsCard({ ref }: { ref?: Ref<ImageSettingsHandle> }) {
  const [config, setConfig] = useState<PublicImageConfig>({ ...DEFAULT_IMAGE_CONFIG, hasKey: false, configured: false });
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/settings/images").then(async response => {
      const data = await response.json();
      if (!response.ok || !data.config) throw new Error();
      setConfig(data.config);
    }).catch(() => setMessage("图片配置加载失败，请刷新"))
      .finally(() => setLoading(false));
  }, []);

  async function submit(mode: "models" | "save") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/settings/images", {
        method: mode === "models" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model: config.model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "图片配置操作失败");
      if (mode === "models") {
        setModels(data.models);
        setMessage(`拉到 ${data.models.length} 个模型`);
      } else {
        setConfig(data.config); setApiKey(""); setDirty(false);
      }
    } finally { setBusy(false); }
  }

  useImperativeHandle(ref, () => ({
    async saveIfChanged() {
      if (!dirty) return;
      if (busy) throw new Error("图片模型正在验证，请稍候保存");
      await submit("save");
    },
  }));

  return <section className="settings-card" aria-label="GotoCC 图片模型">
    <div className="settings-card-heading">
      <div className="settings-card-index">04</div>
      <div className="settings-card-icon"><Image size={18} /></div>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">图片模型</h2>
        <p className="mt-1 text-[11px] text-[#7a889c]">GotoCC · 原创背景</p>
      </div>
    </div>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <label className="settings-field">
        <span className="flex items-center gap-1.5"><KeyRound size={12} />API Key</span>
        <input className="settings-input" type="password" autoComplete="off" disabled={loading || busy} value={apiKey}
          placeholder={config.hasKey ? "已保存，留空保留" : "填写 GotoCC API Key"}
          onChange={event => { setApiKey(event.target.value); setDirty(true); }} />
      </label>
      <div>
        <div className="flex items-center justify-between text-[11px] font-medium text-[#66758a]">
          <label htmlFor="background-image-model">模型</label>
          <button type="button" disabled={loading || busy} className="flex items-center gap-1.5 text-[#2f80ff]"
            onClick={() => void submit("models").catch(error => setMessage(error instanceof Error ? error.message : "拉取失败"))}>
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}拉取模型
          </button>
        </div>
        <input id="background-image-model" className="settings-input" list="background-image-models" disabled={loading || busy} value={config.model}
          onChange={event => { setConfig({ ...config, model: event.target.value }); setDirty(true); }} />
        <datalist id="background-image-models">{models.map(id => <option key={id} value={id} />)}</datalist>
      </div>
    </div>
    {message && <p role="status" className="mt-3 text-[11px] text-[#66758a]">{message}</p>}
  </section>;
}
