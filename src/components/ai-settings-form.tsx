"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, Save, TestTube2 } from "lucide-react";
import type { AiProviderSettings } from "@/lib/types";

type Settings = AiProviderSettings & { hasPluginAccessCode: boolean };

export function AiSettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState({ baseUrl: initial.baseUrl, model: initial.model || "gpt-5.6", apiStyle: initial.apiStyle, apiKey: "", pluginAccessCode: "", enabled: initial.enabled, screenAnalysisEnabled: initial.screenAnalysisEnabled });
  const [hasApiKey, setHasApiKey] = useState(initial.hasApiKey);
  const [loading, setLoading] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState("");
  function value<K extends keyof typeof form>(key: K, next: (typeof form)[K]) { setForm((current) => ({ ...current, [key]: next })); }
  async function save() {
    setLoading("save"); setMessage("");
    const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json(); setLoading(null);
    setMessage(response.ok ? "配置已加密保存，运行时立即生效。" : result.error);
    if (response.ok) { if (form.apiKey) setHasApiKey(true); setForm((current) => ({ ...current, apiKey: "", pluginAccessCode: "" })); }
  }
  async function test() {
    setLoading("test"); setMessage("");
    const response = await fetch("/api/settings/ai", { method: "POST" });
    const result = await response.json(); setLoading(null);
    setMessage(response.ok ? `连接成功 · ${result.data.model} · ${result.data.latencyMs}ms` : result.error);
  }
  return <div className="panel panel-padded">
    <div className="form-grid">
      <div className="field full"><label htmlFor="ai-base-url">Sub2API Base URL</label><input id="ai-base-url" value={form.baseUrl} onChange={(event) => value("baseUrl", event.target.value)} placeholder="https://your-sub2api.example/v1" /></div>
      <div className="field"><label htmlFor="ai-model">模型</label><input id="ai-model" value={form.model} onChange={(event) => value("model", event.target.value)} /></div>
      <div className="field"><label htmlFor="ai-style">接口格式</label><select id="ai-style" value={form.apiStyle} onChange={(event) => value("apiStyle", event.target.value as typeof form.apiStyle)}><option value="chat_completions">Chat Completions</option><option value="responses">Responses API</option></select></div>
      <div className="field full"><label htmlFor="ai-key">API Key</label><input id="ai-key" type="password" value={form.apiKey} onChange={(event) => value("apiKey", event.target.value)} placeholder={initial.hasApiKey ? `已保存：${initial.maskedApiKey}（留空不修改）` : "输入 Sub2API Key"} autoComplete="new-password" /></div>
      <div className="field full"><label htmlFor="plugin-code">Chrome 插件访问码</label><input id="plugin-code" type="password" value={form.pluginAccessCode} onChange={(event) => value("pluginAccessCode", event.target.value)} placeholder={initial.hasPluginAccessCode ? "已配置（留空不修改）" : "至少 10 个字符"} autoComplete="new-password" /></div>
    </div>
    <div className="toggle-list">
      <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={(event) => value("enabled", event.target.checked)} /><span><strong>启用 Sub2API</strong><small>简历结构化分析和搜索策略使用 gpt-5.6</small></span></label>
      <label className="check-row"><input type="checkbox" checked={form.screenAnalysisEnabled} onChange={(event) => value("screenAnalysisEnabled", event.target.checked)} /><span><strong>启用插件截图与扫描分析</strong><small>只在 HR 主动操作后发送关键帧，不在后台持久化画面</small></span></label>
    </div>
    <div className="form-actions"><button className="button primary" onClick={save} disabled={Boolean(loading)}>{loading === "save" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存配置</button><button className="button" onClick={test} disabled={Boolean(loading) || !hasApiKey}><TestTube2 size={16} />测试连接</button>{message ? <span className="inline-message"><CheckCircle2 size={15} />{message}</span> : null}</div>
    <div className="secret-note"><KeyRound size={16} /><span>API Key 与插件访问码使用 AES-256-GCM 加密后存入本机数据库；页面和接口不会返回明文。</span></div>
  </div>;
}
