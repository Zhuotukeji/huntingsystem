"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { CampaignOrganization, ReviewStatus } from "@/lib/types";
import { organizationStatusLabels } from "@/lib/labels";
import { StatusBadge } from "@/components/ui";

export function OrganizationWorkbench({ organizations, initialQuery = "" }: { organizations: CampaignOrganization[]; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => organizations.filter((item) => {
    const searchable = [item.name, item.category, item.location, ...item.roleNames, ...item.markets, ...item.channels].join(" ").toLowerCase();
    return (status === "ALL" || item.status === status) && searchable.includes(query.trim().toLowerCase());
  }), [organizations, query, status]);

  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function review(nextStatus: ReviewStatus, ids = [...selected]) {
    if (!ids.length) return;
    setLoading(true);
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "organization", ids, status: nextStatus, reason: nextStatus === "REJECTED" ? "人才迁移性或业务画像不符" : "人工审核" }) });
    const result = await response.json();
    setLoading(false); setMessage(response.ok ? `已更新 ${result.data.count} 家公司` : result.error); setSelected(new Set());
    if (response.ok) router.refresh();
    window.setTimeout(() => setMessage(""), 3200);
  }

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={15} /><input aria-label="搜索公司" placeholder="搜索公司、任职职位、市场或渠道" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select className="select" aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option>{Object.entries(organizationStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {selected.size ? <div className="selection-actions"><span>已选择 {selected.size} 家公司</span><button className="button small" disabled={loading} onClick={() => review("APPROVED")}><Check size={14} />批准</button><button className="button small" disabled={loading} onClick={() => review("WATCHLIST")}>加入观察</button><button className="button small danger" disabled={loading} onClick={() => review("REJECTED")}><X size={14} />排除</button></div> : null}
    {filtered.length ? <div className="table-scroll"><table className="entity-table organization-table"><thead><tr><th></th><th>公司</th><th>简历人才</th><th>发现职位</th><th>市场 / 渠道</th><th>匹配 / 证据</th><th>状态</th><th>详情</th></tr></thead><tbody>{filtered.map((item) => <Fragment key={item.id}>
      <tr className={selected.has(item.id) || expanded === item.id ? "selected" : ""}>
        <td><input className="entity-check" type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td>
        <td className="cell-title"><strong>{item.name}</strong><span>{item.location} · {item.size}</span></td>
        <td><strong>{item.talentCount}</strong> 人</td>
        <td>{item.roleNames.slice(0, 3).join("、") || "职位待确认"}</td>
        <td>{[...item.markets, ...item.channels].slice(0, 4).join("、") || "待补充"}</td>
        <td><strong>{item.fitScore}</strong> / {item.evidenceCoverage}</td>
        <td><StatusBadge status={item.status} label={organizationStatusLabels[item.status]} /></td>
        <td><button className="plain-action detail-trigger" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded === item.id ? "收起" : "查看"}</button></td>
      </tr>
      {expanded === item.id ? <tr className="detail-row"><td colSpan={8}><EntityDetails item={item} onReview={review} /></td></tr> : null}
    </Fragment>)}</tbody></table></div> : <div className="panel"><div className="empty-state"><Search size={28} /><strong>没有符合筛选的公司</strong><p>公司只会从已授权简历的任职经历中学习产生；可先向简历库新增资料并运行增量学习。</p></div></div>}
    {loading ? <div className="toast"><LoaderCircle className="spin" size={17} />正在保存审核结果</div> : message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}
  </>;
}

function EntityDetails({ item, onReview }: { item: CampaignOrganization; onReview: (status: ReviewStatus, ids: string[]) => Promise<void> }) {
  return <div className="organization-detail-grid">
    <section><h4><Sparkles size={14} />AI 学习结论</h4><p>{item.recommendationReason}</p><dl className="profile-facts"><div><dt>业务市场</dt><dd>{item.markets.join("、") || "待确认"}</dd></div><div><dt>渠道</dt><dd>{item.channels.join("、") || "待确认"}</dd></div><div><dt>身份可信度</dt><dd>{item.confidence}%</dd></div></dl></section>
    <section><h4><ShieldCheck size={14} />简历证据</h4>{item.evidence.length ? item.evidence.map((evidence) => <div className="evidence-item" key={evidence.id}><strong>{evidence.claimText}</strong><p>{evidence.quote}</p><span>{evidence.sourceTitle} · 可信度 {Math.round(evidence.confidence * 100)}%</span></div>) : <p>暂无可展示证据。</p>}</section>
    <section><h4><AlertCircle size={14} />待人工确认</h4><ul>{item.unknowns.length ? item.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>) : <li>暂无待确认项</li>}</ul><div className="detail-actions">{item.status !== "APPROVED" ? <button className="button small" onClick={() => onReview("APPROVED", [item.id])}>批准公司</button> : null}<button className="button small" onClick={() => onReview("WATCHLIST", [item.id])}>加入观察</button></div></section>
  </div>;
}
