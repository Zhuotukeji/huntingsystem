"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, ExternalLink, Grid2X2, List, LoaderCircle, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { CampaignOrganization, ReviewStatus } from "@/lib/types";
import { organizationStatusLabels } from "@/lib/labels";
import { Score, StatusBadge } from "@/components/ui";

export function OrganizationWorkbench({ organizations }: { organizations: CampaignOrganization[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => organizations.filter((item) => (status === "ALL" || item.status === status) && `${item.name}${item.category}${item.location}${item.products.join("")}`.toLowerCase().includes(query.toLowerCase())), [organizations, query, status]);

  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function review(nextStatus: ReviewStatus, ids = [...selected]) {
    if (!ids.length) return;
    setLoading(true);
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "organization", ids, status: nextStatus, reason: nextStatus === "REJECTED" ? "模式或人才迁移性不符" : "人工审核" }) });
    const result = await response.json(); setLoading(false);
    setMessage(response.ok ? `已更新 ${result.data.count} 家公司` : result.error); setSelected(new Set()); router.refresh(); window.setTimeout(() => setMessage(""), 3200);
  }

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={15} /><input aria-label="搜索公司" placeholder="搜索公司、产品或地区" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select className="select" aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option>{Object.entries(organizationStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className="select" aria-label="排序"><option>匹配分从高到低</option><option>证据覆盖率</option><option>最近更新</option></select>
      <div className="segmented" aria-label="视图切换"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} title="卡片视图" aria-label="卡片视图"><Grid2X2 size={15} /></button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")} title="表格视图" aria-label="表格视图"><List size={16} /></button></div>
    </div>
    {selected.size ? <div className="selection-actions"><span>已选择 {selected.size} 家公司</span><button className="button small" disabled={loading} onClick={() => review("APPROVED")}><Check size={14} />批准</button><button className="button small" disabled={loading} onClick={() => review("WATCHLIST")}>加入观察</button><button className="button small danger" disabled={loading} onClick={() => review("REJECTED")}><X size={14} />排除</button></div> : null}
    {view === "cards" ? <div className="entity-grid">{filtered.map((item) => <article className={`entity-card ${selected.has(item.id) ? "selected" : ""}`} key={item.id}>
      <div className="entity-top"><input className="entity-check" aria-label={`选择 ${item.name}`} type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /><div className="entity-title"><h3>{item.name}</h3><p>{item.location} · {item.size} · {item.domain}</p></div><div className="entity-score" title="匹配分">{item.fitScore}</div></div>
      <div className="tag-row"><StatusBadge status={item.status} label={organizationStatusLabels[item.status]} /><span className="tag">{item.category}</span>{item.channels.slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
      <p className="entity-reason">{item.recommendationReason}</p>
      <div className="score-strip"><Score value={item.fitScore} label="匹配程度" /><Score value={item.evidenceCoverage} label="证据覆盖" /><Score value={item.confidence} label="身份可信" /></div>
      {expanded === item.id ? <EntityDetails item={item} /> : null}
      <div className="entity-foot"><span className="owner">负责人：{item.ownerName}</span><div><button className="plain-action" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? "收起" : `查看 ${item.evidence.length} 条证据`}</button>{item.status === "PENDING_REVIEW" ? <button className="plain-action" onClick={() => review("APPROVED", [item.id])}>批准</button> : null}</div></div>
    </article>)}</div> : <table className="entity-table"><thead><tr><th></th><th>公司</th><th>类型</th><th>地区 / 规模</th><th>评分</th><th>证据</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className={selected.has(item.id) ? "selected" : ""}><td><input className="entity-check" type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td><td className="cell-title"><strong>{item.name}</strong><span>{item.products.join("、") || "产品待确认"}</span></td><td>{item.category}</td><td>{item.location}<br />{item.size}</td><td><strong>{item.fitScore}</strong> / {item.evidenceCoverage}</td><td>{item.evidence.length} 条</td><td><StatusBadge status={item.status} label={organizationStatusLabels[item.status]} /></td><td><button className="plain-action" onClick={() => review("APPROVED", [item.id])}>批准</button></td></tr>)}</tbody></table>}
    {!filtered.length ? <div className="empty-state"><Search size={28} /><strong>没有符合筛选的公司</strong><p>调整关键词或状态筛选，也可以返回战役运行新一轮公司发现。</p></div> : null}
    {loading ? <div className="toast"><LoaderCircle className="spin" size={17} />正在保存审核结果</div> : message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}
  </>;
}

function EntityDetails({ item }: { item: CampaignOrganization }) {
  return <div className="details">
    <div className="detail-group"><h4><Sparkles size={13} color="#6f5a89" />已确认与推测</h4>{item.evidence.map((evidence) => <div className="evidence-item" key={evidence.id}><strong>{evidence.classification === "FACT" ? "事实" : "推测"} · {evidence.claimText}</strong><p>{evidence.quote}</p><span>{evidence.sourceProvider} · 可信度 {Math.round(evidence.confidence * 100)}%</span></div>)}</div>
    <div className="detail-group"><h4><AlertCircle size={13} color="#a75b25" />待验证</h4><ul>{item.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul></div>
    <div className="detail-group"><h4><ShieldCheck size={13} color="#245f54" />来源合规</h4><p>来源为 HR 主动导入或系统演示资料。系统未自动访问需要登录的平台。</p></div>
    {item.evidence.some((evidence) => evidence.sourceUrl) ? <a className="text-link" href={item.evidence.find((evidence) => evidence.sourceUrl)?.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 <ExternalLink size={11} /></a> : null}
  </div>;
}
