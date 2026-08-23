"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, Archive, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, GitBranch, Grid2X2, History, Inbox, Layers3, List, LoaderCircle, Search, ShieldCheck, Sparkles, UserRoundSearch, X } from "lucide-react";
import type { CampaignPerson, PersonStatus } from "@/lib/types";
import { personStatusLabels, shortDate } from "@/lib/labels";
import { commonPersonTransitions, isPersonStatus, PERSON_OUTCOME_STAGES, PERSON_PIPELINE_STAGES, PERSON_STATUS_DESCRIPTIONS, PERSON_STATUS_TRANSITIONS, terminalReasonStatuses } from "@/lib/person-workflow";
import { Score, StatusBadge } from "@/components/ui";

type PendingTransition = { ids: string[]; status: PersonStatus };

type CampaignOption = { id: string; name: string };
type SortMode = "FIT" | "EVIDENCE" | "UPDATED";
type QueueScope = "FOCUS" | "REVIEW" | "ARCHIVE" | "ALL";

const focusStatuses = new Set<PersonStatus>(["READY_TO_CONTACT", "CONTACTED", "ENGAGED", "SCREENING", "CONVERTED", "INTERVIEWING", "OFFERED", "HIRED"]);
const reviewStatuses = new Set<PersonStatus>(["PENDING_REVIEW", "NEEDS_RESEARCH"]);
const archiveStatuses = new Set<PersonStatus>(["TALENT_POOL", "CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"]);
const focusPipelineStages = PERSON_PIPELINE_STAGES.filter((stage) => !["DISCOVERED", "REVIEW"].includes(stage.key));

function scopeForStatus(value: PersonStatus): QueueScope {
  if (focusStatuses.has(value)) return "FOCUS";
  if (reviewStatuses.has(value)) return "REVIEW";
  return "ARCHIVE";
}

function scopeForStatuses(values: PersonStatus[]): QueueScope {
  if (values.length && values.every((value) => focusStatuses.has(value))) return "FOCUS";
  if (values.length && values.every((value) => reviewStatuses.has(value))) return "REVIEW";
  if (values.length && values.every((value) => archiveStatuses.has(value))) return "ARCHIVE";
  return "ALL";
}

function matchesScope(value: PersonStatus, scope: QueueScope) {
  return scope === "ALL" || scope === "FOCUS" && focusStatuses.has(value) || scope === "REVIEW" && reviewStatuses.has(value) || scope === "ARCHIVE" && archiveStatuses.has(value);
}

export function PersonWorkbench({ people, campaigns = [], currentCampaignId = "", initialQuery = "", initialStatus = "ALL", initialStage = "ALL", canManage = false }: { people: CampaignPerson[]; campaigns?: CampaignOption[]; currentCampaignId?: string; initialQuery?: string; initialStatus?: string; initialStage?: string; canManage?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(isPersonStatus(initialStatus) ? initialStatus : "ALL");
  const validStage = [...PERSON_PIPELINE_STAGES, ...PERSON_OUTCOME_STAGES].some((stage) => stage.key === initialStage) ? initialStage : "ALL";
  const [stageFilter, setStageFilter] = useState(validStage);
  const initialStageDefinition = [...PERSON_PIPELINE_STAGES, ...PERSON_OUTCOME_STAGES].find((stage) => stage.key === validStage);
  const defaultScope = people.some((person) => focusStatuses.has(person.status)) ? "FOCUS" : people.some((person) => reviewStatuses.has(person.status)) ? "REVIEW" : "ARCHIVE";
  const [scope, setScope] = useState<QueueScope>(isPersonStatus(initialStatus) ? scopeForStatus(initialStatus) : initialStageDefinition ? scopeForStatuses(initialStageDefinition.statuses) : defaultScope);
  const [sortMode, setSortMode] = useState<SortMode>("FIT");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transition, setTransition] = useState<PendingTransition | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const selectedPeople = useMemo(() => people.filter((person) => selected.has(person.id)), [people, selected]);
  const commonTransitions = useMemo(() => commonPersonTransitions(selectedPeople.map((person) => person.status)), [selectedPeople]);
  const filtered = useMemo(() => people.filter((item) => {
    const stage = [...PERSON_PIPELINE_STAGES, ...PERSON_OUTCOME_STAGES].find((candidate) => candidate.key === stageFilter);
    const stageMatches = stageFilter === "ALL" || stage?.key === "DISCOVERED" || Boolean(stage?.statuses.includes(item.status));
    return matchesScope(item.status, scope) && stageMatches && (status === "ALL" || item.status === status) && `${item.name}${item.headline}${item.organizationName}${item.slot}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((left, right) => {
    if (sortMode === "EVIDENCE") return right.evidenceCoverage - left.evidenceCoverage || right.fitScore - left.fitScore;
    if (sortMode === "UPDATED") return new Date(right.lastInteractionAt || right.updatedAt).getTime() - new Date(left.lastInteractionAt || left.updatedAt).getTime();
    return right.fitScore - left.fitScore || right.evidenceCoverage - left.evidenceCoverage;
  }), [people, query, scope, sortMode, stageFilter, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visiblePeople = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const focusCount = people.filter((person) => focusStatuses.has(person.status)).length;
  const reviewCount = people.filter((person) => reviewStatuses.has(person.status)).length;
  const archiveCount = people.filter((person) => archiveStatuses.has(person.status)).length;
  const detailedQueue = scope === "FOCUS" || scope === "ALL";

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function openTransition(nextStatus: PersonStatus, ids: string[]) {
    if (!ids.length) return;
    setNote("");
    setMessage("");
    setTransition({ ids, status: nextStatus });
  }

  async function confirmTransition() {
    if (!transition) return;
    if (terminalReasonStatuses.has(transition.status) && !note.trim()) {
      setMessageType("error");
      setMessage("该状态必须填写原因，方便未来重新评估和审计");
      return;
    }
    setLoading(true);
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "person", ids: transition.ids, status: transition.status, reason: note.trim() || "人工推进" }) });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessageType("error");
      setMessage(result.error || "状态更新失败");
      return;
    }
    setMessageType("success");
    setMessage(`已将 ${result.data.count} 名人选更新为“${personStatusLabels[transition.status]}”`);
    setSelected(new Set());
    setTransition(null);
    router.refresh();
    window.setTimeout(() => setMessage(""), 3600);
  }

  function applyPipelineFilter(key: string) {
    setStageFilter(key);
    setStatus("ALL");
    setScope("FOCUS");
    setPage(1);
    setSelected(new Set());
  }

  function applyScopeFilter(nextScope: QueueScope) {
    setScope(nextScope);
    setStageFilter("ALL");
    setStatus("ALL");
    setPage(1);
    setSelected(new Set());
    setExpanded(null);
  }

  function applyStatusFilter(nextStatus: string) {
    setStatus(nextStatus);
    setStageFilter("ALL");
    if (isPersonStatus(nextStatus)) setScope(scopeForStatus(nextStatus));
    setPage(1);
    setSelected(new Set());
  }

  return <>
    <section className="person-pipeline" aria-label="战役人才推进阶段">
      <div className="person-pipeline-head"><div><strong>重点推进阶段</strong><span>从待联系到入职，点击阶段聚焦当前行动队列</span></div><div className="person-pipeline-total"><Activity size={15} /><span>正在重点推进</span><strong>{focusCount}</strong></div></div>
      <div className="person-pipeline-stages">{focusPipelineStages.map((stage) => {
        const count = people.filter((person) => stage.statuses.includes(person.status)).length;
        return <button type="button" className={stageFilter === stage.key ? "active" : ""} key={stage.key} onClick={() => applyPipelineFilter(stage.key)}><span>{stage.label}</span><strong>{count}</strong></button>;
      })}</div>
    </section>

    <nav className="person-queue-tabs" aria-label="候选人工作队列">
      <button type="button" className={scope === "FOCUS" ? "active" : ""} onClick={() => applyScopeFilter("FOCUS")}><Activity size={17} /><span><strong>重点推进</strong><small>待联系至入职</small></span><b>{focusCount}</b></button>
      <button type="button" className={scope === "REVIEW" ? "active" : ""} onClick={() => applyScopeFilter("REVIEW")}><Inbox size={17} /><span><strong>待判断</strong><small>审核与补充</small></span><b>{reviewCount}</b></button>
      <button type="button" className={scope === "ARCHIVE" ? "active" : ""} onClick={() => applyScopeFilter("ARCHIVE")}><Archive size={17} /><span><strong>暂缓与结束</strong><small>人才库、淘汰与退出</small></span><b>{archiveCount}</b></button>
      <button type="button" className={scope === "ALL" ? "active" : ""} onClick={() => applyScopeFilter("ALL")}><Layers3 size={17} /><span><strong>全部候选人</strong><small>跨状态检索</small></span><b>{people.length}</b></button>
    </nav>

    <div className="toolbar person-toolbar">{campaigns.length > 1 ? <select className="select campaign-select" aria-label="切换战役" value={currentCampaignId} onChange={(event) => router.push(`/people?campaignId=${encodeURIComponent(event.target.value)}`)}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select> : null}<div className="search-field"><Search size={15} /><input aria-label="搜索人选" placeholder="搜索姓名、公司、岗位或槽位" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div><select className="select" aria-label="筛选状态" value={status} onChange={(event) => applyStatusFilter(event.target.value)}><option value="ALL">当前队列全部状态</option>{Object.entries(personStatusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><select className="select" aria-label="排序" value={sortMode} onChange={(event) => { setSortMode(event.target.value as SortMode); setPage(1); }}><option value="FIT">匹配分从高到低</option><option value="EVIDENCE">证据覆盖率</option><option value="UPDATED">最近推进时间</option></select><select className="select page-size-select" aria-label="每页数量" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={12}>每页 12 人</option><option value={24}>每页 24 人</option><option value={48}>每页 48 人</option></select>{detailedQueue ? <div className="segmented"><button aria-label="卡片视图" title="卡片视图" className={view === "cards" ? "active" : ""} onClick={() => { setView("cards"); setPage(1); }}><Grid2X2 size={15} /></button><button aria-label="表格视图" title="表格视图" className={view === "table" ? "active" : ""} onClick={() => { setView("table"); setPage(1); }}><List size={16} /></button></div> : null}</div>

    {canManage && selected.size ? <div className="selection-actions"><span>已选择 {selected.size} 名人选</span><select className="select" aria-label="批量更新状态" value="" onChange={(event) => { if (event.target.value) openTransition(event.target.value as PersonStatus, [...selected]); }}><option value="">批量推进到...</option>{commonTransitions.map((value) => <option value={value} key={value}>{personStatusLabels[value]}</option>)}</select></div> : null}

    {detailedQueue ? view === "cards" ? <div className="entity-grid">{visiblePeople.map((person) => {
      const nextStatus = PERSON_STATUS_TRANSITIONS[person.status][0];
      return <article className={`entity-card ${selected.has(person.id) ? "selected" : ""}`} key={person.id}>
        <div className="entity-top">{canManage ? <input className="entity-check" type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /> : null}<div className="avatar">{person.name.slice(0,1)}</div><div className="entity-title"><h3>{person.name}</h3><p>{person.headline}</p></div><div className="entity-score" title="匹配分">{person.fitScore}</div></div>
        <div className="tag-row"><StatusBadge status={person.status} label={personStatusLabels[person.status]} /><span className="tag">{person.organizationName}</span><span className="tag">{person.location}</span></div>
        <p className="entity-reason">{person.recommendationReason}</p>
        <div className="score-strip"><Score value={person.fitScore} label="能力匹配" /><Score value={person.evidenceCoverage} label="证据覆盖" /><Score value={person.identityConfidence} label="身份可信" /></div>
        {expanded === person.id ? <PersonDetails person={person} /> : null}
        <div className="entity-foot"><span className="owner">{person.slot} · {person.lastInteractionAt ? `最近推进 ${shortDate(person.lastInteractionAt)}` : person.ownerName}</span><div className="person-actions"><button className="plain-action" onClick={() => setExpanded(expanded === person.id ? null : person.id)}>{expanded === person.id ? "收起" : "详情"}</button>{canManage && nextStatus ? <button className="button small" onClick={() => openTransition(nextStatus, [person.id])}>{personStatusLabels[nextStatus]}<ArrowRight size={13} /></button> : null}{canManage && PERSON_STATUS_TRANSITIONS[person.status].length > 1 ? <select className="compact-status-select" aria-label={`更新 ${person.name} 的状态`} value="" onChange={(event) => { if (event.target.value) openTransition(event.target.value as PersonStatus, [person.id]); }}><option value="">更多...</option>{PERSON_STATUS_TRANSITIONS[person.status].map((value) => <option value={value} key={value}>{personStatusLabels[value]}</option>)}</select> : null}</div></div>
      </article>;
    })}</div> : <div className="table-scroll"><table className="entity-table"><thead><tr><th></th><th>人选</th><th>当前公司</th><th>人员槽位</th><th>评分</th><th>最近推进</th><th>状态</th><th>下一步</th></tr></thead><tbody>{visiblePeople.map((person) => {
      const nextStatus = PERSON_STATUS_TRANSITIONS[person.status][0];
      return <tr key={person.id} className={selected.has(person.id) ? "selected" : ""}><td>{canManage ? <input className="entity-check" type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /> : null}</td><td className="cell-title"><strong>{person.name}</strong><span>{person.headline}</span></td><td>{person.organizationName}</td><td>{person.slot}</td><td><strong>{person.fitScore}</strong> / {person.evidenceCoverage}</td><td>{shortDate(person.lastInteractionAt || person.updatedAt)}</td><td><StatusBadge status={person.status} label={personStatusLabels[person.status]} /></td><td>{canManage && nextStatus ? <button className="plain-action detail-trigger" onClick={() => openTransition(nextStatus, [person.id])}>{personStatusLabels[nextStatus]}<ArrowRight size={13} /></button> : "-"}</td></tr>;
    })}</tbody></table></div> : <div className="compact-person-list">{visiblePeople.map((person) => {
      const nextStatus = PERSON_STATUS_TRANSITIONS[person.status][0];
      return <article className={`compact-person-row ${selected.has(person.id) ? "selected" : ""}`} key={person.id}>
        <div className="compact-person-main">{canManage ? <input className="entity-check" type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /> : null}<div className="avatar compact-person-avatar">{person.name.slice(0,1)}</div><div className="compact-person-identity"><strong>{person.name}</strong><span>{person.headline || "岗位待补充"}</span></div><div className="compact-person-context"><strong>{person.organizationName}</strong><span>{person.slot} · {person.location}</span></div><StatusBadge status={person.status} label={personStatusLabels[person.status]} /><div className="compact-person-score"><strong>{person.fitScore}</strong><span>匹配分</span></div><div className="person-actions"><button className="plain-action" onClick={() => setExpanded(expanded === person.id ? null : person.id)}>{expanded === person.id ? "收起" : "详情"}</button>{canManage && nextStatus ? <button className="button small" onClick={() => openTransition(nextStatus, [person.id])}>{personStatusLabels[nextStatus]}<ArrowRight size={13} /></button> : null}{canManage && PERSON_STATUS_TRANSITIONS[person.status].length > 1 ? <select className="compact-status-select" aria-label={`更新 ${person.name} 的状态`} value="" onChange={(event) => { if (event.target.value) openTransition(event.target.value as PersonStatus, [person.id]); }}><option value="">更多...</option>{PERSON_STATUS_TRANSITIONS[person.status].map((value) => <option value={value} key={value}>{personStatusLabels[value]}</option>)}</select> : null}</div></div>
        {expanded === person.id ? <div className="compact-person-details"><PersonDetails person={person} /></div> : null}
      </article>;
    })}</div>}
    {!filtered.length ? <div className="empty-state"><UserRoundSearch size={28} /><strong>{scope === "FOCUS" ? "暂无重点推进候选人" : scope === "REVIEW" ? "暂无待判断候选人" : scope === "ARCHIVE" ? "暂无暂缓或已结束候选人" : "没有符合条件的候选人"}</strong><p>{scope === "FOCUS" ? "通过审核并推进到待联系后，候选人会进入这里。" : "可以切换工作队列、状态或搜索条件查看其他人选。"}</p></div> : null}
    {filtered.length ? <PersonPagination currentPage={currentPage} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPageChange={setPage} /> : null}

    {transition ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) setTransition(null); }}><form className="modal person-transition-modal" role="dialog" aria-modal="true" aria-labelledby="person-transition-title" onSubmit={(event) => { event.preventDefault(); void confirmTransition(); }}>
      <div className="modal-head"><div><h2 id="person-transition-title">推进到“{personStatusLabels[transition.status]}”</h2><p>{transition.ids.length} 名人选 · {PERSON_STATUS_DESCRIPTIONS[transition.status]}</p></div><button className="icon-button" type="button" onClick={() => setTransition(null)} disabled={loading} aria-label="关闭" title="关闭"><X size={18} /></button></div>
      <div className="modal-body"><div className="field"><label htmlFor="transition-note">推进记录{terminalReasonStatuses.has(transition.status) ? "（必填）" : "（选填）"}</label><textarea id="transition-note" rows={4} value={note} onChange={(event) => setNote(event.target.value)} required={terminalReasonStatuses.has(transition.status)} placeholder={terminalReasonStatuses.has(transition.status) ? "说明暂不推进、淘汰或退出的具体原因" : "记录沟通结果、候选人意愿或下一步安排"} /></div>{message && messageType === "error" ? <div className="form-error" role="alert">{message}</div> : null}</div>
      <div className="modal-foot"><button className="button" type="button" onClick={() => setTransition(null)} disabled={loading}>取消</button><button className="button primary" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}确认推进</button></div>
    </form></div> : null}

    {loading && !transition ? <div className="toast"><LoaderCircle className="spin" size={17} />正在保存状态</div> : message && !transition ? <div className={`toast ${messageType === "error" ? "error" : ""}`}><CheckCircle2 size={17} />{message}</div> : null}
  </>;
}

function PersonPagination({ currentPage, pageCount, total, pageSize, onPageChange }: { currentPage: number; pageCount: number; total: number; pageSize: number; onPageChange: (page: number) => void }) {
  const first = (currentPage - 1) * pageSize + 1;
  const last = Math.min(currentPage * pageSize, total);
  return <nav className="person-pagination" aria-label="候选人分页"><span>显示 {first}-{last}，共 {total} 人</span><div><button className="icon-button compact" type="button" aria-label="上一页" title="上一页" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft size={16} /></button><strong>{currentPage} / {pageCount}</strong><button className="icon-button compact" type="button" aria-label="下一页" title="下一页" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}><ChevronRight size={16} /></button></div></nav>;
}

function PersonDetails({ person }: { person: CampaignPerson }) {
  return <div className="details">
    <div className="detail-group"><h4><ShieldCheck size={13} color="#245f54" />已确认事实</h4>{person.evidence.filter((item) => item.classification === "FACT").map((item) => <div className="evidence-item" key={item.id}><strong>{item.claimText}</strong><p>{item.quote}</p><span>{item.sourceProvider} · 可信度 {Math.round(item.confidence * 100)}%</span></div>)}</div>
    <div className="detail-group"><h4><Sparkles size={13} color="#6f5a89" />AI 推测</h4>{person.evidence.filter((item) => item.classification === "INFERENCE").map((item) => <div className="evidence-item" key={item.id}><strong>{item.claimText}</strong><p>{item.quote}</p></div>)}</div>
    <div className="detail-group"><h4><UserRoundSearch size={13} color="#a75b25" />沟通待验证</h4><ul>{person.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div>
    {person.riskFlags.length ? <div className="detail-group"><h4><AlertTriangle size={13} color="#a2463f" />风险提示</h4><ul>{person.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    <div className="detail-group"><h4><History size={13} color="#3e6f9e" />推进记录</h4>{person.stageHistory.length ? <ol className="stage-history">{person.stageHistory.map((event) => <li key={event.id}><div><strong>{(personStatusLabels as Record<string, string>)[event.status] || event.status}</strong><time>{shortDate(event.createdAt)}</time></div><p>{event.reason || "未填写补充说明"}</p><span>{event.operatorName}</span></li>)}</ol> : <p>尚无人工推进记录。</p>}</div>
    <div className="detail-group"><h4><GitBranch size={13} color="#245f54" />来源与策略归因</h4>{person.origins.length ? person.origins.map((origin) => <div className="evidence-item" key={origin.id}><strong>{origin.sourceType === "BOSS_VISIBLE_SCREENSHOT" ? "BOSS 插件扫描" : origin.sourceType}</strong><p>{origin.keywords.length ? `关键词：${origin.keywords.join("、")}` : "未关联搜索关键词"}</p><span>{origin.searchTaskId ? `任务 ${origin.searchTaskId.slice(0, 8)}` : "无任务来源"} · {origin.strategyVersionId ? `策略 ${origin.strategyVersionId.slice(0, 8)}` : "无策略版本"} · {shortDate(origin.createdAt)}</span></div>) : <p>该候选人来自历史数据，尚未关联搜索策略。</p>}</div>
  </div>;
}
