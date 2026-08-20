import { notFound } from "next/navigation";
import { Building2, Database, Search, Users } from "lucide-react";
import { CampaignStatusButton, DiscoveryButton } from "@/components/action-button";
import { PageIntro, StatusBadge } from "@/components/ui";
import { campaignStatusLabels } from "@/lib/labels";
import { getCampaign, listOrganizations, listPeople, listTasks } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();
  const organizations = listOrganizations(id);
  const people = listPeople(id);
  const tasks = listTasks().filter((task) => task.campaignId === id);
  const approvedOrganizations = organizations.filter((item) => item.status === "APPROVED").length;
  const readyPeople = people.filter((item) => ["READY_TO_CONTACT", "CONTACTED", "ENGAGED", "CONVERTED"].includes(item.status)).length;

  return <>
    <PageIntro eyebrow="Active Campaign" title={campaign.name} description={campaign.roleName} actions={<><StatusBadge status={campaign.status} label={campaignStatusLabels[campaign.status]} /><CampaignStatusButton id={id} status={campaign.status} /></>} />
    <div className="campaign-summary">
      <div className="summary-block"><h3>业务目标</h3><p>{campaign.businessGoal}</p><h3>候选人价值主张</h3><p>{campaign.valueProposition}</p></div>
      <div className="summary-block" style={{ padding: 0 }}><div className="mini-stat-grid"><div className="mini-stat"><strong>{organizations.length}</strong><span>已发现公司</span></div><div className="mini-stat"><strong>{approvedOrganizations}</strong><span>已批准公司</span></div><div className="mini-stat"><strong>{people.length}</strong><span>已发现人选</span></div><div className="mini-stat"><strong>{readyPeople}</strong><span>进入触达</span></div></div></div>
    </div>

    <section className="section">
      <div className="section-head"><div><h3>AI 工作流</h3><p>所有发现结果都先进入人工审核，不会自动淘汰或联系候选人</p></div></div>
      <div className="toolbar" style={{ padding: 14 }}>
        <DiscoveryButton campaignId={id} type="organizations" label="运行图谱增量学习" />
        <a className="button" href="/resumes">导入授权简历</a>
        <a className="button" href="/search-tasks">查看 BOSS 搜索任务</a>
        <DiscoveryButton campaignId={id} type="insighttracker" label="生成 InsightTracker 调研任务" variant="secondary" />
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
      <div className="section-head"><div><h3>发现进度</h3><p>本战役累计任务 {tasks.length} 个</p></div></div>
      <div className="panel">
        <div className="data-row"><div className="row-icon"><Building2 size={18} /></div><div className="row-main"><strong>公司地图</strong><span>{organizations.filter((item) => item.status === "PENDING_REVIEW").length} 家等待审核 · 目标 {campaign.targetOrganizationCount} 家</span></div><a href="/organizations" className="button small">审核公司</a></div>
        <div className="data-row"><div className="row-icon"><Users size={18} /></div><div className="row-main"><strong>人选队列</strong><span>{people.filter((item) => ["PENDING_REVIEW", "NEEDS_RESEARCH"].includes(item.status)).length} 人等待判断 · 目标 {campaign.targetPersonCount} 人</span></div><a href="/people" className="button small">审核人选</a></div>
        <div className="data-row"><div className="row-icon"><Database size={18} /></div><div className="row-main"><strong>人工调研</strong><span>InsightTracker 无 API，采用指令包与合规人工导入</span></div><a href="/research" className="button small">进入调研</a></div>
        <div className="data-row"><div className="row-icon"><Search size={18} /></div><div className="row-main"><strong>搜索范围</strong><span>{campaign.locations.join("、")} · {campaign.markets.join("、")} · {campaign.channels.join("、")}</span></div></div>
      </div>
    </section>
  </>;
}
