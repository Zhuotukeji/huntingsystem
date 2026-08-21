import Link from "next/link";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { listCampaigns, listOrganizations, listPeople } from "@/lib/repository";
import { campaignStatusLabels } from "@/lib/labels";
import { CampaignCreate } from "@/components/campaign-create";
import { PageIntro, StatusBadge } from "@/components/ui";
import { hasPermission, requirePagePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await requirePagePermission("campaigns.view");
  const campaigns = listCampaigns();
  const organizations = listOrganizations();
  const people = listPeople();
  return <>
    <PageIntro eyebrow="Campaigns" title="寻访战役" description="每个战役都从业务结果和成功画像开始，独立沉淀公司地图、人选队列与反馈。" actions={hasPermission(user, "campaigns.manage") ? <CampaignCreate /> : undefined} />
    <div className="campaign-grid">
      {campaigns.map((campaign) => {
        const orgCount = organizations.filter((item) => item.campaignId === campaign.id).length;
        const personCount = people.filter((item) => item.campaignId === campaign.id).length;
        const engagedCount = people.filter((item) => item.campaignId === campaign.id && ["ENGAGED", "SCREENING", "CONVERTED", "INTERVIEWING", "OFFERED", "HIRED"].includes(item.status)).length;
        return <Link className="campaign-card" href={`/campaigns/${campaign.id}`} key={campaign.id}>
          <div className="campaign-card-head"><div className="row-icon"><BriefcaseBusiness size={18} /></div><StatusBadge status={campaign.status} label={campaignStatusLabels[campaign.status]} /></div>
          <h3 style={{ marginTop: 14 }}>{campaign.name}</h3><p className="role">{campaign.roleName} · {campaign.ownerName}</p>
          <p className="goal">{campaign.businessGoal}</p>
          <div className="progress-label"><span>目标人选</span><strong>{personCount} / {campaign.targetPersonCount}</strong></div><div className="progress-track"><div style={{ width: `${Math.min((personCount / campaign.targetPersonCount) * 100, 100)}%` }} /></div>
          <div className="campaign-card-foot"><span>{orgCount} 家公司 · {personCount} 名人选 · {engagedCount} 有效沟通</span><ArrowRight size={15} /></div>
        </Link>;
      })}
    </div>
  </>;
}
