"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, Grid2X2, List, LoaderCircle, Search, ShieldCheck, Sparkles, UserRoundSearch, X } from "lucide-react";
import type { CampaignPerson, PersonStatus } from "@/lib/types";
import { personStatusLabels } from "@/lib/labels";
import { Score, StatusBadge } from "@/components/ui";

export function PersonWorkbench({ people }: { people: CampaignPerson[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("ALL"); const [view, setView] = useState<"cards" | "table">("cards"); const [selected, setSelected] = useState<Set<string>>(new Set()); const [expanded, setExpanded] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");
  const filtered = useMemo(() => people.filter((item) => (status === "ALL" || item.status === status) && `${item.name}${item.headline}${item.organizationName}${item.slot}`.toLowerCase().includes(query.toLowerCase())), [people, query, status]);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function review(nextStatus: PersonStatus, ids = [...selected]) {
    if (!ids.length) return; setLoading(true);
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "person", ids, status: nextStatus, reason: "人工审核" }) }); const result = await response.json(); setLoading(false); setMessage(response.ok ? `已更新 ${result.data.count} 名人选` : result.error); setSelected(new Set()); router.refresh(); window.setTimeout(() => setMessage(""), 3200);
  }
  return <>
    <div className="toolbar"><div className="search-field"><Search size={15} /><input aria-label="搜索人选" placeholder="搜索姓名、公司、岗位或槽位" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="select" aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option>{Object.entries(personStatusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><select className="select" aria-label="排序"><option>匹配分从高到低</option><option>证据覆盖率</option><option>身份可信度</option></select><div className="segmented"><button aria-label="卡片视图" title="卡片视图" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}><Grid2X2 size={15} /></button><button aria-label="表格视图" title="表格视图" className={view === "table" ? "active" : ""} onClick={() => setView("table")}><List size={16} /></button></div></div>
    {selected.size ? <div className="selection-actions"><span>已选择 {selected.size} 名人选</span><button className="button small" disabled={loading} onClick={() => review("READY_TO_CONTACT")}><Check size={14} />批准触达</button><button className="button small" disabled={loading} onClick={() => review("NEEDS_RESEARCH")}>补充研究</button><button className="button small" disabled={loading} onClick={() => review("TALENT_POOL")}>加入人才库</button><button className="button small danger" disabled={loading} onClick={() => review("CLOSED")}><X size={14} />关闭</button></div> : null}
    {view === "cards" ? <div className="entity-grid">{filtered.map((person) => <article className={`entity-card ${selected.has(person.id) ? "selected" : ""}`} key={person.id}>
      <div className="entity-top"><input className="entity-check" type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /><div className="avatar">{person.name.slice(0,1)}</div><div className="entity-title"><h3>{person.name}</h3><p>{person.headline}</p></div><div className="entity-score" title="匹配分">{person.fitScore}</div></div>
      <div className="tag-row"><StatusBadge status={person.status} label={personStatusLabels[person.status]} /><span className="tag">{person.organizationName}</span><span className="tag">{person.location}</span></div>
      <p className="entity-reason">{person.recommendationReason}</p>
      <div className="score-strip"><Score value={person.fitScore} label="能力匹配" /><Score value={person.evidenceCoverage} label="证据覆盖" /><Score value={person.identityConfidence} label="身份可信" /></div>
      {expanded === person.id ? <PersonDetails person={person} /> : null}
      <div className="entity-foot"><span className="owner">{person.slot} · {person.ownerName}</span><div><button className="plain-action" onClick={() => setExpanded(expanded === person.id ? null : person.id)}>{expanded === person.id ? "收起" : "证据卡"}</button>{person.status === "PENDING_REVIEW" ? <button className="plain-action" onClick={() => review("READY_TO_CONTACT", [person.id])}>批准触达</button> : null}</div></div>
    </article>)}</div> : <table className="entity-table"><thead><tr><th></th><th>人选</th><th>当前公司</th><th>人员槽位</th><th>评分</th><th>未知项</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((person) => <tr key={person.id} className={selected.has(person.id) ? "selected" : ""}><td><input className="entity-check" type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /></td><td className="cell-title"><strong>{person.name}</strong><span>{person.headline}</span></td><td>{person.organizationName}</td><td>{person.slot}</td><td><strong>{person.fitScore}</strong> / {person.evidenceCoverage}</td><td>{person.unknowns.length} 项</td><td><StatusBadge status={person.status} label={personStatusLabels[person.status]} /></td><td><button className="plain-action" onClick={() => review("READY_TO_CONTACT", [person.id])}>批准</button></td></tr>)}</tbody></table>}
    {!filtered.length ? <div className="empty-state"><UserRoundSearch size={28} /><strong>没有符合筛选的人选</strong><p>调整筛选条件，或从已批准公司运行新一轮人员发现。</p></div> : null}
    {loading ? <div className="toast"><LoaderCircle className="spin" size={17} />正在保存审核结果</div> : message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}
  </>;
}

function PersonDetails({ person }: { person: CampaignPerson }) {
  return <div className="details">
    <div className="detail-group"><h4><ShieldCheck size={13} color="#245f54" />已确认事实</h4>{person.evidence.filter((item) => item.classification === "FACT").map((item) => <div className="evidence-item" key={item.id}><strong>{item.claimText}</strong><p>{item.quote}</p><span>{item.sourceProvider} · 可信度 {Math.round(item.confidence * 100)}%</span></div>)}</div>
    <div className="detail-group"><h4><Sparkles size={13} color="#6f5a89" />AI 推测</h4>{person.evidence.filter((item) => item.classification === "INFERENCE").map((item) => <div className="evidence-item" key={item.id}><strong>{item.claimText}</strong><p>{item.quote}</p></div>)}</div>
    <div className="detail-group"><h4><UserRoundSearch size={13} color="#a75b25" />首次沟通待验证</h4><ul>{person.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div>
    {person.riskFlags.length ? <div className="detail-group"><h4><AlertTriangle size={13} color="#a2463f" />风险提示</h4><ul>{person.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
  </div>;
}
