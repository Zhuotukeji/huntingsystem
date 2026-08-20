"use client";

import { useMemo, useState } from "react";
import { BriefcaseBusiness, ChevronDown, ChevronUp, FilePlus2, FileText, MapPin, Search, ShieldCheck, X } from "lucide-react";
import { ResumeWorkbench } from "@/components/resume-workbench";
import { StatusBadge } from "@/components/ui";
import type { Campaign, ResumeProfile } from "@/lib/types";

const statusLabels: Record<string, string> = { PENDING: "待学习", PROCESSING: "分析中", READY: "已入图谱", NEEDS_REVIEW: "需复核", FAILED: "失败" };
const sourceLabels: Record<string, string> = {
  CANDIDATE_SHARED: "候选人提供", OFFICIAL_DOWNLOAD: "官方授权导出", BOSS_AUTHORIZED_DOWNLOAD: "BOSS 授权下载",
  AUTHORIZED_TEXT: "授权文本", INTERNAL_ARCHIVE: "内部合规存档", INTERNAL_AUTHORIZED: "内部授权资料",
};

export function ResumeLibrary({ resumes, campaigns }: { resumes: ResumeProfile[]; campaigns: Campaign[] }) {
  const [query, setQuery] = useState("");
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
      <button className="button primary" onClick={() => setAdding(true)}><FilePlus2 size={16} />新增简历</button>
    </div>

    {filtered.length ? <div className="table-scroll"><table className="entity-table resume-table"><thead><tr><th>候选人</th><th>当前公司 / 职位</th><th>画像</th><th>来源</th><th>更新时间</th><th>状态</th><th>详情</th></tr></thead><tbody>
      {filtered.map((resume) => {
        const current = resume.employments.find((item) => item.isCurrent) || resume.employments[0];
        const open = expanded === resume.id;
        return <ResumeRows key={resume.id} resume={resume} current={current} open={open} onToggle={() => setExpanded(open ? null : resume.id)} />;
      })}
    </tbody></table></div> : <div className="panel"><div className="empty-state"><FileText size={28} /><strong>{resumes.length ? "没有符合筛选的简历" : "简历库为空"}</strong><p>{resumes.length ? "调整关键词、画像或状态筛选。" : "点击“新增简历”，导入第一份已获授权的候选人资料。"}</p></div></div>}

    {adding ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="resume-import-title">
      <div className="modal-head"><div><h2 id="resume-import-title">新增简历并识别</h2><p>导入后可立即进入 AI 增量学习</p></div><button className="icon-button" onClick={() => setAdding(false)} aria-label="关闭" title="关闭"><X size={18} /></button></div>
      <div className="modal-body"><ResumeWorkbench campaigns={campaigns} /></div>
    </section></div> : null}
  </>;
}

function ResumeRows({ resume, current, open, onToggle }: { resume: ResumeProfile; current?: ResumeProfile["employments"][number]; open: boolean; onToggle: () => void }) {
  const updated = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(resume.updatedAt));
  return <>
    <tr className={open ? "selected" : ""}>
      <td className="cell-title"><strong>{resume.personName || "等待 AI 识别"}</strong><span>{resume.personHeadline || resume.fileName}</span></td>
      <td className="cell-title"><strong>{current?.organizationName || "任职公司待识别"}</strong><span>{current?.rawTitle || resume.personLocation || "职位待识别"}</span></td>
      <td>{resume.campaignName}</td><td>{sourceLabels[resume.sourceType] || resume.sourceType}</td><td>{updated}</td>
      <td><StatusBadge status={resume.status} label={statusLabels[resume.status] || resume.status} /></td>
      <td><button className="plain-action detail-trigger" onClick={onToggle}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{open ? "收起" : "查看"}</button></td>
    </tr>
    {open ? <tr className="detail-row"><td colSpan={7}><ResumeDetails resume={resume} /></td></tr> : null}
  </>;
}

function ResumeDetails({ resume }: { resume: ResumeProfile }) {
  return <div className="resume-detail-grid">
    <section><h4><BriefcaseBusiness size={14} />任职经历</h4>{resume.employments.length ? <div className="employment-list">{resume.employments.map((employment) => <div key={employment.id}><strong>{employment.organizationName} · {employment.rawTitle}</strong><span>{employment.startDate || "起始时间未知"} - {employment.isCurrent ? "至今" : employment.endDate || "结束时间未知"} · 可信度 {Math.round(employment.confidence * 100)}%</span>{employment.summary ? <p>{employment.summary}</p> : null}</div>)}</div> : <p className="detail-empty">尚未识别出可靠任职经历。</p>}</section>
    <section><h4><MapPin size={14} />候选人信息</h4><dl className="profile-facts"><div><dt>姓名</dt><dd>{resume.personName || "待识别"}</dd></div><div><dt>职位</dt><dd>{resume.personHeadline || "待识别"}</dd></div><div><dt>所在地</dt><dd>{resume.personLocation || "待识别"}</dd></div><div><dt>技能</dt><dd>{resume.skills.length ? <span className="tag-row">{resume.skills.slice(0, 12).map((skill) => <span className="tag" key={skill.name}>{skill.name}</span>)}</span> : "待识别"}</dd></div></dl></section>
    <section><h4><ShieldCheck size={14} />档案与授权</h4><dl className="profile-facts"><div><dt>文件</dt><dd>{resume.fileName}</dd></div><div><dt>处理依据</dt><dd>{resume.legalBasis}</dd></div><div><dt>创建人</dt><dd>{resume.createdBy}</dd></div><div><dt>保留规则</dt><dd>永久保留</dd></div><div><dt>内容指纹</dt><dd className="hash-value">{resume.contentHash}</dd></div></dl>{resume.errorMessage ? <p className="row-error">{resume.errorMessage}</p> : null}</section>
  </div>;
}
