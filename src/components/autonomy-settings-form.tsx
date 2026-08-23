"use client";

import { useState } from "react";
import { CheckCircle2, Globe2, LoaderCircle, Save, TestTube2 } from "lucide-react";
import type { AutonomySettings } from "@/lib/types";

export function AutonomySettingsForm({ initial }: { initial: AutonomySettings }) {
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState("");
  function update<K extends keyof AutonomySettings>(key: K, value: AutonomySettings[K]) { setForm((current) => ({ ...current, [key]: value })); }
  async function save() {
    setLoading("save"); setMessage("");
    const response = await fetch("/api/settings/autonomy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json(); setLoading(null);
    if (response.ok) setForm(result.data);
    setMessage(response.ok ? "AI 自主复盘和情报治理设置已保存。" : result.error);
  }
  async function testCapability() {
    setLoading("test"); setMessage("");
    const response = await fetch("/api/intelligence/capability", { method: "POST" });
    const result = await response.json(); setLoading(null);
    update("webSearchCapability", response.ok ? "AVAILABLE" : "UNAVAILABLE");
    setMessage(response.ok ? `联网搜索可用 · ${result.data.model} · ${result.data.latencyMs}ms` : result.error);
  }
  const numberField = (key: keyof AutonomySettings, label: string, min: number, max: number, step = 1) => <div className="field"><label htmlFor={`autonomy-${key}`}>{label}</label><input id={`autonomy-${key}`} type="number" min={min} max={max} step={step} value={String(form[key])} onChange={(event) => update(key, Number(event.target.value) as never)} /></div>;
  return <div className="panel panel-padded autonomy-settings">
    <div className="toggle-list">
      <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span><strong>启用有边界自主</strong><small>允许内部研究、复盘、任务生成和小步策略调整，不执行外部发送或关键招聘决策</small></span></label>
      <label className="check-row"><input type="checkbox" checked={form.webResearchEnabled} onChange={(event) => update("webResearchEnabled", event.target.checked)} /><span><strong>启用公开网络研究</strong><small>仅在 Responses API web_search 能力检测通过后执行</small></span></label>
    </div>
    <div className="quality-policy-grid">
      {numberField("researchDailyLimit", "每日研究任务上限", 1, 200)}
      {numberField("researchConcurrency", "研究并发", 1, 5)}
      {numberField("researchCooldownDays", "同主题冷却天数", 1, 30)}
      {numberField("claimPromotionMinimumConfidence", "事实晋升最低置信度", 60, 100)}
      {numberField("currentBusinessFreshnessDays", "当前业务有效天数", 30, 730)}
      {numberField("hiringSignalFreshnessDays", "招聘信号有效天数", 7, 365)}
      {numberField("projectFreshnessDays", "项目状态有效天数", 30, 365)}
      {numberField("reviewMinimumTasks", "复盘最少任务数", 1, 50)}
      {numberField("reviewMinimumResults", "复盘最少结果数", 1, 1000)}
      {numberField("explorationPercent", "探索任务占比", 0, 50)}
      {numberField("maximumWeightDelta", "单次最大权重调整", 0.01, 0.08, 0.01)}
      {numberField("projectSearchMinimumConfidence", "项目搜索最低置信度", 60, 100)}
      {numberField("talentDemandMinimumConfidence", "人才需求推断最低置信度", 50, 100)}
    </div>
    <div className="capability-line"><Globe2 size={16} /><span>联网能力：{form.webSearchCapability === "AVAILABLE" ? "可用" : form.webSearchCapability === "UNAVAILABLE" ? "不可用" : "未检测"}</span></div>
    <div className="form-actions"><button className="button primary" disabled={Boolean(loading)} onClick={save}>{loading === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存</button><button className="button" disabled={Boolean(loading)} onClick={testCapability}>{loading === "test" ? <LoaderCircle className="spin" size={15} /> : <TestTube2 size={15} />}检测 web_search</button>{message ? <span className="inline-message"><CheckCircle2 size={15} />{message}</span> : null}</div>
  </div>;
}
