import { Building2, Radar } from "lucide-react";
import { DiscoveryButton } from "@/components/action-button";
import { OrganizationWorkbench } from "@/components/organization-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listOrganizations } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default function OrganizationsPage() {
  const campaigns = listCampaigns();
  const campaign = campaigns.find((item) => item.status === "ACTIVE") || campaigns[0];
  const organizations = campaign ? listOrganizations(campaign.id) : [];
  return <>
    <PageIntro eyebrow="Company Intelligence" title="目标公司审核" description={`当前战役：${campaign?.name || "暂无"}。总分只用于排序，决策时同时查看匹配程度、证据覆盖率和身份可信度。`} actions={campaign ? <DiscoveryButton campaignId={campaign.id} type="organizations" label="运行公司发现" /> : undefined} />
    <div className="compliance-note" style={{ marginTop: 0, marginBottom: 16 }}><Radar size={18} /><div><strong>发现边界</strong><br />当前可用来源为 InsightTracker 人工调研、BOSS 直聘人工线索与 HR 合规导入。系统不会自动登录或绕过平台限制。</div></div>
    {organizations.length ? <OrganizationWorkbench organizations={organizations} /> : <div className="panel"><div className="empty-state"><Building2 size={28} /><strong>还没有公司线索</strong><p>先创建并激活寻访战役，再运行公司发现或导入调研资料。</p></div></div>}
  </>;
}
