"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import type { CandidateAutomationSettings, CandidateAutoProgressRule } from "@/lib/types";

const targetLabels: Record<CandidateAutoProgressRule["targetStatus"], string> = {
  NEEDS_RESEARCH: "待补充",
  READY_TO_CONTACT: "待联系",
  TALENT_POOL: "人才库",
  CLOSED: "本战役淘汰",
  DO_NOT_CONTACT: "请勿联系",
};

function newRule(): CandidateAutoProgressRule {
  return { id: crypto.randomUUID(), minimum: 80, maximum: 100, targetStatus: "READY_TO_CONTACT", enabled: true };
}

export function CandidateAutomationForm({ initial }: { initial: CandidateAutomationSettings }) {
  const [rules, setRules] = useState(initial.rules);
  const [searchTaskMinimumScore, setSearchTaskMinimumScore] = useState(initial.searchTaskMinimumScore);
  const [resumeQualityPolicy, setResumeQualityPolicy] = useState(initial.resumeQualityPolicy);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function updateRule(id: string, patch: Partial<CandidateAutoProgressRule>) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }

  function updateQualityPolicy(key: keyof CandidateAutomationSettings["resumeQualityPolicy"], value: number) {
    setResumeQualityPolicy((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings/candidate-automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, searchTaskMinimumScore, resumeQualityPolicy }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "自动推进规则保存失败");
      const saved = result.data as CandidateAutomationSettings;
      setRules(saved.rules);
      setSearchTaskMinimumScore(saved.searchTaskMinimumScore);
      setResumeQualityPolicy(saved.resumeQualityPolicy);
      setMessage("学习自动化规则已保存，下一次学习任务立即生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动推进规则保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <div className="panel panel-padded candidate-automation-panel">
    <div className="quality-policy-setting">
      <div className="quality-policy-intro"><strong>简历与图谱质量闸门</strong><small>先验证简历结构和原文证据，再决定是否进入图谱、自动推进或生成反向搜索任务。</small></div>
      <div className="quality-policy-grid">
        <QualityField id="quality-quarantine" label="隔离线" detail="低于该分不调用 AI、不写图谱" value={resumeQualityPolicy.quarantineBelow} min={0} max={100} onChange={(value) => updateQualityPolicy("quarantineBelow", value)} />
        <QualityField id="quality-graph" label="图谱准入线" detail="达到后才创建人才、公司和关系" value={resumeQualityPolicy.graphMinimumScore} min={0} max={100} onChange={(value) => updateQualityPolicy("graphMinimumScore", value)} />
        <QualityField id="quality-high" label="高可信线" detail="达到后才允许自动推进和反向搜索" value={resumeQualityPolicy.highConfidenceMinimumScore} min={0} max={100} onChange={(value) => updateQualityPolicy("highConfidenceMinimumScore", value)} />
        <QualityField id="quality-org-confidence" label="公司搜索可信度" detail="公司综合可信度的最低要求" value={resumeQualityPolicy.organizationSearchMinimumConfidence} min={0} max={100} onChange={(value) => updateQualityPolicy("organizationSearchMinimumConfidence", value)} />
        <QualityField id="quality-org-sources" label="搜索独立来源" detail="生成搜索任务所需的高质量简历数" value={resumeQualityPolicy.organizationSearchMinimumSources} min={1} max={10} onChange={(value) => updateQualityPolicy("organizationSearchMinimumSources", value)} />
        <QualityField id="quality-business-sources" label="业务事实来源" detail="推断公司业务状态所需的交叉来源数" value={resumeQualityPolicy.businessFactMinimumSources} min={1} max={10} onChange={(value) => updateQualityPolicy("businessFactMinimumSources", value)} />
        <QualityField id="quality-max-organizations" label="单份公司上限" detail="超过部分不进入图谱，防止异常扩散" value={resumeQualityPolicy.maxOrganizationsPerResume} min={1} max={30} onChange={(value) => updateQualityPolicy("maxOrganizationsPerResume", value)} />
        <QualityField id="quality-max-skills" label="单份技能上限" detail="超过部分不进入技能图谱" value={resumeQualityPolicy.maxSkillsPerResume} min={1} max={50} onChange={(value) => updateQualityPolicy("maxSkillsPerResume", value)} />
      </div>
    </div>
    <div className="search-threshold-setting">
      <div><strong>搜索任务最低分</strong><small>公司匹配分达到该分数后生成 BOSS 搜索任务</small></div>
      <div className="field"><label htmlFor="search-task-minimum-score">最低分</label><input id="search-task-minimum-score" type="number" min={0} max={100} step={1} value={searchTaskMinimumScore} onChange={(event) => setSearchTaskMinimumScore(Number(event.target.value))} /></div>
    </div>
    <div className="automation-rule-head" aria-hidden="true"><span>启用</span><span>最低分</span><span>最高分</span><span>推进到</span><span>操作</span></div>
    <div className="automation-rule-list">
      {rules.map((rule) => <div className="automation-rule" key={rule.id}>
        <label className="automation-enabled"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /><span>启用</span></label>
        <div className="field"><label htmlFor={`rule-min-${rule.id}`}>最低分</label><input id={`rule-min-${rule.id}`} type="number" min={0} max={100} step={1} value={rule.minimum} onChange={(event) => updateRule(rule.id, { minimum: Number(event.target.value) })} /></div>
        <div className="field"><label htmlFor={`rule-max-${rule.id}`}>最高分</label><input id={`rule-max-${rule.id}`} type="number" min={0} max={100} step={1} value={rule.maximum} onChange={(event) => updateRule(rule.id, { maximum: Number(event.target.value) })} /></div>
        <div className="field"><label htmlFor={`rule-target-${rule.id}`}>AI 自动推进到</label><select id={`rule-target-${rule.id}`} value={rule.targetStatus} onChange={(event) => updateRule(rule.id, { targetStatus: event.target.value as CandidateAutoProgressRule["targetStatus"] })}>{Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <button className="icon-button compact danger-icon" type="button" title="删除规则" aria-label="删除规则" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}><Trash2 size={16} /></button>
      </div>)}
      {!rules.length ? <div className="automation-empty">尚未配置自动推进规则</div> : null}
    </div>
    <div className="form-actions automation-actions">
      <button className="button" type="button" onClick={() => setRules((current) => [...current, newRule()])} disabled={rules.length >= 20}><Plus size={16} />添加区间</button>
      <button className="button primary" type="button" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存规则</button>
      {message ? <span className="inline-message"><CheckCircle2 size={15} />{message}</span> : null}
    </div>
  </div>;
}

function QualityField({ id, label, detail, value, min, max, onChange }: { id: string; label: string; detail: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="quality-policy-field" htmlFor={id}><span><strong>{label}</strong><small>{detail}</small></span><input id={id} type="number" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
