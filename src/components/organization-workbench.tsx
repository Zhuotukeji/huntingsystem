"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronUp, Eye, Globe2, History, LoaderCircle, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { CampaignOrganization, EvidenceClaim, IntelligenceProject, IntelligenceSource, OrganizationEvent, OrganizationStatus } from "@/lib/types";
import { organizationBusinessStatusLabels, organizationStatusLabels } from "@/lib/labels";
import { StatusBadge } from "@/components/ui";

type IntelligenceBundle = { projects: IntelligenceProject[]; claims: EvidenceClaim[]; sources: IntelligenceSource[]; events: OrganizationEvent[] };

export function OrganizationWorkbench({ organizations, intelligence = {}, initialQuery = "", canManage = false, canResearch = false }: { organizations: CampaignOrganization[]; intelligence?: Record<string, IntelligenceBundle>; initialQuery?: string; canManage?: boolean; canResearch?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => organizations.filter((item) => {
    const searchable = [item.name, item.category, item.location, item.description, item.businessStatusSummary, ...item.roleNames, ...item.products, ...item.markets, ...item.channels, ...item.monetization, ...item.businessHistory, ...item.currentBusiness, ...item.businessSignals].join(" ").toLowerCase();
    return (status === "ALL" || item.status === status) && searchable.includes(query.trim().toLowerCase());
  }), [organizations, query, status]);

  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function updateStatus(nextStatus: OrganizationStatus, ids = [...selected]) {
    if (!ids.length) return;
    setLoading(true);
    const reasons: Record<OrganizationStatus, string> = { AI_LEARNED: "恢复 AI 自主学习入库", WATCHLIST: "人工标记为重点观察", REJECTED: "人才迁移性或业务画像不符" };
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "organization", ids, status: nextStatus, reason: reasons[nextStatus] }) });
    const result = await response.json();
    setLoading(false); setMessage(response.ok ? `已更新 ${result.data.count} 家公司` : result.error); setSelected(new Set());
    if (response.ok) router.refresh();
    window.setTimeout(() => setMessage(""), 3200);
  }

  async function research(item: CampaignOrganization) {
    setLoading(true); setMessage("");
    const response = await fetch("/api/intelligence/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: item.campaignId, organizationId: item.organizationId, topic: "核实当前业务、公开项目、产品落地与组织变化" }) });
    const result = await response.json(); setLoading(false); setMessage(response.ok ? "已创建公开网络研究任务" : result.error);
    if (response.ok) router.refresh();
  }

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={15} /><input aria-label="搜索公司" placeholder="搜索公司、任职职位、市场或渠道" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select className="select" aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option>{Object.entries(organizationStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {canManage && selected.size ? <div className="selection-actions"><span>已选择 {selected.size} 家公司</span><button className="button small" disabled={loading} onClick={() => updateStatus("AI_LEARNED")}><RotateCcw size={14} />恢复入库</button><button className="button small" disabled={loading} onClick={() => updateStatus("WATCHLIST")}><Eye size={14} />重点观察</button><button className="button small danger" disabled={loading} onClick={() => updateStatus("REJECTED")}><X size={14} />排除</button></div> : null}
    {filtered.length ? <div className="table-scroll"><table className="entity-table organization-table"><thead><tr><th></th><th>公司</th><th>简历人才</th><th>发现职位</th><th>当前业务</th><th>匹配 / 可信</th><th>状态</th><th>详情</th></tr></thead><tbody>{filtered.map((item) => <Fragment key={item.id}>
      <tr className={selected.has(item.id) || expanded === item.id ? "selected" : ""}>
        <td>{canManage ? <input className="entity-check" type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /> : null}</td>
        <td className="cell-title"><strong>{item.name}</strong><span>{item.location} · {item.size}</span></td>
        <td><strong>{item.talentCount}</strong> 人</td>
        <td>{item.roleNames.slice(0, 3).join("、") || "职位待确认"}</td>
        <td className="business-cell">{item.currentBusiness.slice(0, 2).join("；") || item.products.slice(0, 4).join("、") || "证据待积累"}</td>
        <td className="cell-title"><strong>{item.fitScore} / {item.confidence}</strong><span>{item.evidenceSourceCount} 份来源 · 质量 {item.sourceQualityScore}</span></td>
        <td><StatusBadge status={item.status} label={organizationStatusLabels[item.status]} /></td>
        <td><button className="plain-action detail-trigger" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded === item.id ? "收起" : "查看"}</button></td>
      </tr>
      {expanded === item.id ? <tr className="detail-row"><td colSpan={8}><EntityDetails item={item} intelligence={intelligence[item.organizationId] || { projects: [], claims: [], sources: [], events: [] }} onStatusChange={updateStatus} onResearch={research} canManage={canManage} canResearch={canResearch} /></td></tr> : null}
    </Fragment>)}</tbody></table></div> : <div className="panel"><div className="empty-state"><Search size={28} /><strong>没有符合筛选的公司</strong><p>公司只会从已授权简历的任职经历中学习产生；可先向简历库新增资料并运行增量学习。</p></div></div>}
    {loading ? <div className="toast"><LoaderCircle className="spin" size={17} />正在更新公司状态</div> : message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}
  </>;
}

function InsightList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="business-insight-list">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="detail-empty">{empty}</p>;
}

function EntityDetails({ item, intelligence, onStatusChange, onResearch, canManage, canResearch }: { item: CampaignOrganization; intelligence: IntelligenceBundle; onStatusChange: (status: OrganizationStatus, ids: string[]) => Promise<void>; onResearch: (item: CampaignOrganization) => Promise<void>; canManage: boolean; canResearch: boolean }) {
  return <div className="organization-detail-grid">
    <section><h4><Sparkles size={14} />AI 业务画像</h4><p>{item.description || item.recommendationReason}</p><dl className="profile-facts"><div><dt>业务类型</dt><dd>{item.category || "待识别"}</dd></div><div><dt>产品 / 能力</dt><dd>{item.products.join("、") || "证据待积累"}</dd></div><div><dt>业务市场</dt><dd>{item.markets.join("、") || "证据待积累"}</dd></div><div><dt>渠道</dt><dd>{item.channels.join("、") || "证据待积累"}</dd></div><div><dt>商业化</dt><dd>{item.monetization.join("、") || "证据待积累"}</dd></div><div><dt>画像可信度</dt><dd>{item.confidence}%</dd></div><div><dt>独立简历来源</dt><dd>{item.evidenceSourceCount} 份</dd></div><div><dt>来源质量均分</dt><dd>{item.sourceQualityScore} / 100</dd></div></dl></section>
    <section><h4><History size={14} />历史业务</h4><InsightList items={item.businessHistory} empty="尚未从历史任职记录中识别出明确业务。" /></section>
    <section><h4><BriefcaseBusiness size={14} />当前业务</h4><InsightList items={item.currentBusiness} empty="尚未从当前任职记录中识别出明确业务。" /></section>
    <section><h4><Activity size={14} />业务状况判断</h4><StatusBadge status={item.businessStatus} label={organizationBusinessStatusLabels[item.businessStatus]} /><p>{item.businessStatusSummary}</p><InsightList items={item.businessSignals} empty="暂无支持业务状态判断的明确信号。" /><span className="inference-confidence">判断置信度 {item.businessStatusConfidence}%</span></section>
    <section><h4><ShieldCheck size={14} />简历证据</h4>{item.evidence.length ? item.evidence.map((evidence) => <div className="evidence-item" key={evidence.id}><strong>{evidence.claimText}</strong><p>{evidence.quote}</p><span>{evidence.sourceTitle} · 可信度 {Math.round(evidence.confidence * 100)}%</span></div>) : <p>暂无可展示证据。</p>}</section>
    <section className="intelligence-wide"><h4><BriefcaseBusiness size={14} />竞品项目</h4>{intelligence.projects.length ? <div className="intelligence-timeline">{intelligence.projects.map((project) => <article key={project.id}><div><strong>{project.name}</strong><StatusBadge status={project.status} label={project.status} /></div><p>{project.summary}</p><span>{project.projectType} · {project.region || "地区待核实"} · 事实 {project.confidence}% · 人才需求 {project.talentDemandConfidence}%</span></article>)}</div> : <p className="detail-empty">尚未识别到有可靠公开证据的竞品项目。</p>}</section>
    <section><h4><Activity size={14} />组织与业务时间线</h4>{intelligence.events.length ? <div className="intelligence-timeline">{intelligence.events.map((event) => <article key={event.id}><strong>{event.title}</strong><p>{event.summary}</p><span>{event.occurredAt ? new Date(event.occurredAt).toLocaleDateString("zh-CN") : "时间待核实"} · {event.classification} · {event.confidence}%</span></article>)}</div> : <p className="detail-empty">暂无公开组织事件。</p>}</section>
    <section><h4><Globe2 size={14} />公开来源与事实</h4><div className="claim-summary"><span>正式 {intelligence.claims.filter((claim) => claim.status === "PROMOTED").length}</span><span>待核实 {intelligence.claims.filter((claim) => claim.status === "CANDIDATE").length}</span><span>冲突 {intelligence.claims.filter((claim) => claim.status === "DISPUTED").length}</span><span>过期 {intelligence.claims.filter((claim) => claim.status === "STALE").length}</span></div>{intelligence.claims.slice(0, 8).map((claim) => <div className="evidence-item" key={claim.id}><strong>{claim.statement}</strong><span>{claim.classification} · {claim.status} · 置信度 {claim.confidence}% · {claim.sourceIds.length} 个来源</span></div>)}{intelligence.sources.slice(0, 5).map((source) => <a className="source-link" href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.publisher || source.title} · {source.trustTier}</a>)}{canResearch ? <button className="button small" onClick={() => onResearch(item)}><Globe2 size={14} />补充公开研究</button> : null}</section>
    <section><h4><AlertCircle size={14} />信息缺口</h4><InsightList items={item.unknowns} empty="当前没有额外信息缺口。" />{canManage ? <div className="detail-actions">{item.status !== "AI_LEARNED" ? <button className="button small" onClick={() => onStatusChange("AI_LEARNED", [item.id])}><RotateCcw size={14} />恢复入库</button> : null}{item.status !== "WATCHLIST" ? <button className="button small" onClick={() => onStatusChange("WATCHLIST", [item.id])}><Eye size={14} />重点观察</button> : null}{item.status !== "REJECTED" ? <button className="button small danger" onClick={() => onStatusChange("REJECTED", [item.id])}><X size={14} />排除</button> : null}</div> : null}</section>
  </div>;
}
