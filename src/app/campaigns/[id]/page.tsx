import { notFound } from "next/navigation";
import { Building2, Search, Users } from "lucide-react";
import { CampaignStatusButton } from "@/components/action-button";
import { PageIntro, StatusBadge } from "@/components/ui";
import { campaignStatusLabels } from "@/lib/labels";
import { PERSON_PIPELINE_STAGES } from "@/lib/person-workflow";
import { getCampaign, listOrganizations, listPeople } from "@/lib/repository";
import { listResumes } from "@/lib/resumes";
import { hasPermission, requirePagePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("campaigns.view");
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();
  const organizations = listOrganizations(id);
  const people = listPeople(id);
  const resumes = listResumes(id);
  const learnedOrganizations = organizations.filter((item) => item.status !== "REJECTED").length;
  const readyPeople = people.filter((item) => ["READY_TO_CONTACT", "CONTACTED", "ENGAGED", "SCREENING", "CONVERTED", "INTERVIEWING", "OFFERED", "HIRED"].includes(item.status)).length;
  const talentPoolCount = people.filter((item) => item.status === "TALENT_POOL").length;
  const closedCount = people.filter((item) => ["CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"].includes(item.status)).length;
  const contactedCount = people.filter((item) => ["CONTACTED", "ENGAGED", "SCREENING", "CONVERTED", "INTERVIEWING", "OFFERED", "HIRED"].includes(item.status)).length;
  const engagedCount = people.filter((item) => ["ENGAGED", "SCREENING", "CONVERTED", "INTERVIEWING", "OFFERED", "HIRED"].includes(item.status)).length;
  const interviewCount = people.filter((item) => ["INTERVIEWING", "OFFERED", "HIRED"].includes(item.status)).length;
  const hiredCount = people.filter((item) => item.status === "HIRED").length;
  const workflowSteps = [
    { label: "简历入库", detail: `${resumes.length} 份已授权资料`, href: "/resumes" },
    { label: "AI 分析", detail: `${resumes.filter((item) => item.status === "READY").length} 份已完成`, href: "/learning" },
    { label: "公司学习", detail: `${learnedOrganizations} 家已由 AI 自主入库`, href: `/organizations?campaignId=${id}` },
    { label: "人选审核", detail: `${readyPeople} 已通过 · ${people.filter((item) => ["PENDING_REVIEW", "NEEDS_RESEARCH"].includes(item.status)).length} 待判断`, href: `/people?campaignId=${id}&status=PENDING_REVIEW` },
    { label: "人才触达", detail: `${contactedCount} 人已联系`, href: `/people?campaignId=${id}&status=CONTACTED` },
    { label: "有效沟通", detail: `${engagedCount} 人完成有效沟通`, href: `/people?campaignId=${id}&status=ENGAGED` },
    { label: "面试与 Offer", detail: `${interviewCount} 人进入面试`, href: `/people?campaignId=${id}&status=INTERVIEWING` },
    { label: "入职与沉淀", detail: `${hiredCount} 入职 · ${talentPoolCount} 人才库`, href: `/people?campaignId=${id}&status=HIRED` },
  ];

  return <>
    <PageIntro eyebrow="Active Campaign" title={campaign.name} description={campaign.roleName} actions={<><StatusBadge status={campaign.status} label={campaignStatusLabels[campaign.status]} />{hasPermission(user, "campaigns.manage") ? <CampaignStatusButton id={id} status={campaign.status} /> : null}</>} />
    <div className="campaign-summary">
      <div className="summary-block"><h3>业务目标</h3><p>{campaign.businessGoal}</p><h3>候选人价值主张</h3><p>{campaign.valueProposition}</p></div>
      <div className="summary-block" style={{ padding: 0 }}><div className="mini-stat-grid"><div className="mini-stat"><strong>{organizations.length}</strong><span>已发现公司</span></div><div className="mini-stat"><strong>{learnedOrganizations}</strong><span>AI 已入库</span></div><div className="mini-stat"><strong>{people.length}</strong><span>已发现人选</span></div><div className="mini-stat"><strong>{readyPeople}</strong><span>进入触达</span></div></div></div>
    </div>

    <section className="section">
      <div className="section-head"><div><h3>人才推进漏斗</h3><p>每个数字代表当前所在阶段；点击可进入对应候选人队列</p></div></div>
      <div className="campaign-pipeline">{PERSON_PIPELINE_STAGES.map((stage) => {
        const count = stage.key === "DISCOVERED" ? people.length : people.filter((person) => stage.statuses.includes(person.status)).length;
        const query = stage.key === "DISCOVERED" ? "" : `&stage=${stage.key}`;
        return <a href={`/people?campaignId=${id}${query}`} key={stage.key}><span>{stage.label}</span><strong>{count}</strong></a>;
      })}</div>
      <div className="pipeline-outcomes"><span>人才库 <strong>{talentPoolCount}</strong></span><span>本战役结束 <strong>{closedCount}</strong></span><span>本周有效沟通目标 <strong>{campaign.weeklyTarget}</strong></span></div>
    </section>

    <section className="section">
      <div className="section-head"><div><h3>战役工作流</h3><p>AI 负责公司自主入库和人选评分推进；联系、面试及录用由团队推进</p></div></div>
      <div className="workflow-rail">{workflowSteps.map((step, index) => <a href={step.href} key={step.label}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></a>)}</div>
      <div className="toolbar" style={{ padding: 14 }}>
        <a className="button primary" href="/learning">运行图谱增量学习</a>
        <a className="button" href="/resumes">导入授权简历</a>
        <a className="button" href="/search-tasks">查看 BOSS 搜索任务</a>
      </div>
    </section>

    <section className="section">
      <div className="section-head"><div><h3>成功画像</h3><p>事实缺失会标记为未知，不会被直接判为不符合</p></div></div>
      <div className="criteria-grid">
        <div className="criteria-column"><h3>必须项</h3><ul>{campaign.mustHaves.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div className="criteria-column"><h3>加分项</h3><ul>{campaign.niceToHaves.length ? campaign.niceToHaves.map((item) => <li key={item}>{item}</li>) : <li>待用人经理补充</li>}</ul></div>
        <div className="criteria-column exclusion"><h3>排除项</h3><ul>{campaign.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </section>

    <section className="section">
      <div className="section-head"><div><h3>发现进度</h3><p>数据由授权简历学习并持续更新</p></div></div>
      <div className="panel">
        <div className="data-row"><div className="row-icon"><Building2 size={18} /></div><div className="row-main"><strong>公司地图</strong><span>{learnedOrganizations} 家已自主入库 · 目标 {campaign.targetOrganizationCount} 家</span></div><a href={`/organizations?campaignId=${id}`} className="button small">查看公司</a></div>
        <div className="data-row"><div className="row-icon"><Users size={18} /></div><div className="row-main"><strong>人选队列</strong><span>{people.filter((item) => ["PENDING_REVIEW", "NEEDS_RESEARCH"].includes(item.status)).length} 人等待判断 · 目标 {campaign.targetPersonCount} 人</span></div><a href={`/people?campaignId=${id}`} className="button small">推进人选</a></div>
        <div className="data-row"><div className="row-icon"><Search size={18} /></div><div className="row-main"><strong>搜索范围</strong><span>{campaign.locations.join("、")} · {campaign.markets.join("、")} · {campaign.channels.join("、")}</span></div></div>
      </div>
    </section>
  </>;
}
