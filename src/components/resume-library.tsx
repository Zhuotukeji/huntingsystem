"use client";

import { useMemo, useState } from "react";
import { BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronUp, FilePlus2, FileText, GitMerge, MapPin, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { ResumeWorkbench } from "@/components/resume-workbench";
import { StatusBadge } from "@/components/ui";
import type { Campaign, ResumeProfile } from "@/lib/types";

const statusLabels: Record<string, string> = { PENDING: "待学习", PROCESSING: "分析中", READY: "已入图谱", NEEDS_REVIEW: "质量待复核", QUARANTINED: "已隔离", FAILED: "失败" };
const sourceLabels: Record<string, string> = {
  BOSS_VISIBLE_SCREENSHOT: "BOSS 可见页截图",
  CANDIDATE_SHARED: "候选人提供", OFFICIAL_DOWNLOAD: "官方授权导出", BOSS_AUTHORIZED_DOWNLOAD: "BOSS 授权下载",
  AUTHORIZED_TEXT: "授权文本", INTERNAL_ARCHIVE: "内部合规存档", INTERNAL_AUTHORIZED: "内部授权资料",
};
const identityLabels = {
  AUTO_MERGED: { label: "已自动合并至现有人选", status: "READY" },
  NEW_PROFILE: { label: "已新建候选人档案", status: "NEW" },
  REVIEW_REQUIRED: { label: "发现近似档案，待复核", status: "NEEDS_REVIEW" },
  EXISTING_LINK: { label: "已关联候选人档案", status: "READY" },
} as const;

export function ResumeLibrary({ resumes, campaigns, initialQuery = "", canManage = false }: { resumes: ResumeProfile[]; campaigns: Campaign[]; initialQuery?: string; canManage?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("ALL");
  const [campaignId, setCampaignId] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const filtered = useMemo(() => resumes.filter((resume) => {
    const current = resume.employments.find((item) => item.isCurrent) || resume.employments[0];
    const searchable = [resume.personName, resume.fileName, resume.personHeadline, resume.personLocation, current?.organizationName, ...resume.skills.map((skill) => skill.name)].join(" ").toLowerCase();
    return (status === "ALL" || resume.status === status) && (campaignId === "ALL" || resume.campaignId === campaignId) && searchable.includes(query.trim().toLowerCase());
  }), [campaignId, query, resumes, status]);

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={15} /><input aria-label="搜索简历" placeholder="搜索姓名、公司、职位或技能" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select className="select" aria-label="筛选画像" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="ALL">全部画像</option>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select>
      <select className="select" aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      {canManage ? <button className="button primary" onClick={() => setAdding(true)}><FilePlus2 size={16} />新增简历</button> : null}
    </div>

    {filtered.length ? <div className="table-scroll"><table className="entity-table resume-table"><thead><tr><th>候选人</th><th>当前公司 / 职位</th><th>画像</th><th>来源</th><th>质量</th><th>更新时间</th><th>状态</th><th>详情</th></tr></thead><tbody>
      {filtered.map((resume) => {
        const current = resume.employments.find((item) => item.isCurrent) || resume.employments[0];
        const open = expanded === resume.id;
        return <ResumeRows key={resume.id} resume={resume} current={current} open={open} canManage={canManage} onToggle={() => setExpanded(open ? null : resume.id)} />;
      })}
    </tbody></table></div> : <div className="panel"><div className="empty-state"><FileText size={28} /><strong>{resumes.length ? "没有符合筛选的简历" : "简历库为空"}</strong><p>{resumes.length ? "调整关键词、画像或状态筛选。" : "点击“新增简历”，导入第一份已获授权的候选人资料。"}</p></div></div>}

    {adding ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="resume-import-title">
      <div className="modal-head"><div><h2 id="resume-import-title">新增简历并识别</h2><p>导入后可立即进入 AI 增量学习</p></div><button className="icon-button" onClick={() => setAdding(false)} aria-label="关闭" title="关闭"><X size={18} /></button></div>
      <div className="modal-body"><ResumeWorkbench campaigns={campaigns} /></div>
    </section></div> : null}
  </>;
}

function ResumeRows({ resume, current, open, canManage, onToggle }: { resume: ResumeProfile; current?: ResumeProfile["employments"][number]; open: boolean; canManage: boolean; onToggle: () => void }) {
  const updated = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(resume.updatedAt));
  const identity = resume.identityDecision ? identityLabels[resume.identityDecision] : null;
  return <>
    <tr className={open ? "selected" : ""}>
      <td className="cell-title"><strong>{resume.personName || "等待 AI 识别"}</strong><span>{resume.personHeadline || resume.fileName}{identity ? ` · ${identity.label}` : ""}</span></td>
      <td className="cell-title"><strong>{current?.organizationName || "任职公司待识别"}</strong><span>{current?.rawTitle || resume.personLocation || "职位待识别"}</span></td>
      <td>{resume.campaignName}</td><td>{sourceLabels[resume.sourceType] || resume.sourceType}</td><td><div className={`resume-quality-score ${resume.graphEligible ? "eligible" : resume.status === "QUARANTINED" ? "quarantined" : ""}`}><strong>{resume.qualityScore}</strong><span>{resume.searchEligible ? "可驱动搜索" : resume.graphEligible ? "仅入图谱" : "未准入"}</span></div></td><td>{updated}</td>
      <td><StatusBadge status={resume.status} label={statusLabels[resume.status] || resume.status} /></td>
      <td><button className="plain-action detail-trigger" onClick={onToggle}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{open ? "收起" : "查看"}</button></td>
    </tr>
    {open ? <tr className="detail-row"><td colSpan={8}><ResumeDetails resume={resume} canManage={canManage} /></td></tr> : null}
  </>;
}

function ResumeDetails({ resume, canManage }: { resume: ResumeProfile; canManage: boolean }) {
  const identity = resume.identityDecision ? identityLabels[resume.identityDecision] : null;
  return <div className="resume-detail-grid">
    <section><h4><BriefcaseBusiness size={14} />任职经历</h4>{resume.employments.length ? <div className="employment-list">{resume.employments.map((employment) => <div key={employment.id}><strong>{employment.organizationName} · {employment.rawTitle}</strong><span>{employment.startDate || "起始时间未知"} - {employment.isCurrent ? "至今" : employment.endDate || "结束时间未知"} · 可信度 {Math.round(employment.confidence * 100)}%</span>{employment.summary ? <p>{employment.summary}</p> : null}</div>)}</div> : <p className="detail-empty">尚未识别出可靠任职经历。</p>}</section>
    <section><h4><MapPin size={14} />候选人信息</h4><dl className="profile-facts"><div><dt>姓名</dt><dd>{resume.personName || "待识别"}</dd></div><div><dt>职位</dt><dd>{resume.personHeadline || "待识别"}</dd></div><div><dt>所在地</dt><dd>{resume.personLocation || "待识别"}</dd></div><div><dt>技能</dt><dd>{resume.skills.length ? <span className="tag-row">{resume.skills.slice(0, 12).map((skill) => <span className="tag" key={skill.name}>{skill.name}</span>)}</span> : "待识别"}</dd></div></dl></section>
    <section><h4><ShieldCheck size={14} />质量与授权</h4><dl className="profile-facts"><div><dt>质量分</dt><dd>{resume.qualityScore} / 100</dd></div><div><dt>图谱准入</dt><dd>{resume.graphEligible ? "已准入" : "未准入"}</dd></div><div><dt>反向搜索</dt><dd>{resume.searchEligible ? "允许" : "禁止"}</dd></div><div><dt>文件</dt><dd>{resume.fileName}</dd></div><div><dt>处理依据</dt><dd>{resume.legalBasis}</dd></div><div><dt>创建人</dt><dd>{resume.createdBy}</dd></div><div><dt>保留规则</dt><dd>永久保留</dd></div><div><dt>内容指纹</dt><dd className="hash-value">{resume.contentHash}</dd></div></dl>{resume.qualityReasons.length ? <div className="quality-reason-list">{resume.qualityReasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}{resume.errorMessage ? <p className="row-error">{resume.errorMessage}</p> : null}{canManage && resume.status === "QUARANTINED" ? <QualityReviewActions resumeId={resume.id} /> : null}</section>
    <section><h4><GitMerge size={14} />档案匹配</h4>{identity ? <><dl className="profile-facts"><div><dt>处理结果</dt><dd><StatusBadge status={identity.status} label={identity.label} /></dd></div>{resume.identityMatchedPersonName ? <div><dt>{resume.identityDecision === "REVIEW_REQUIRED" ? "近似人选" : "合并档案"}</dt><dd>{resume.identityMatchedPersonName}</dd></div> : null}<div><dt>匹配分</dt><dd>{Math.round(resume.identityScore || 0)} / 100</dd></div><div><dt>判定置信度</dt><dd>{Math.round((resume.identityConfidence || 0) * 100)}%</dd></div></dl>{resume.identityReasons.length ? <div className="employment-list">{resume.identityReasons.map((reason) => <div key={reason}><span>{reason}</span></div>)}</div> : null}</> : <p className="detail-empty">该简历尚未完成候选人档案匹配。</p>}</section>
  </div>;
}

function QualityReviewActions({ resumeId }: { resumeId: string }) {
  const [busy, setBusy] = useState<"RESTORED" | "CONFIRMED" | null>(null);
  const [error, setError] = useState("");

  async function review(decision: "RESTORED" | "CONFIRMED") {
    if (decision === "CONFIRMED" && !window.confirm("确认该简历属于低质量信息并继续隔离？")) return;
    setBusy(decision);
    setError("");
    try {
      const response = await fetch(`/api/resumes/${resumeId}/quality-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "质量复核失败");
      window.location.reload();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "质量复核失败");
      setBusy(null);
    }
  }

  return <div className="quality-review-actions">
    <button type="button" className="button small" disabled={Boolean(busy)} onClick={() => review("CONFIRMED")}><CheckCircle2 size={14} />确认隔离</button>
    <button type="button" className="button small primary" disabled={Boolean(busy)} onClick={() => review("RESTORED")}><RotateCcw size={14} />标记误拦截并重新学习</button>
    {error ? <p className="row-error">{error}</p> : null}
  </div>;
}
