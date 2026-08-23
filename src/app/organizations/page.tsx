import { BrainCircuit, Building2 } from "lucide-react";
import { OrganizationWorkbench } from "@/components/organization-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listOrganizations } from "@/lib/repository";
import { hasPermission, requirePagePermission } from "@/lib/auth";
import { listEvidenceClaims, listIntelligenceSources, listOrganizationEvents, listProjects } from "@/lib/autonomy";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; campaignId?: string | string[] }> }) {
  const user = await requirePagePermission("organizations.view");
  const params = await searchParams;
  const rawQuery = params.q;
  const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "";
  const requestedCampaignId = Array.isArray(params.campaignId) ? params.campaignId[0] : params.campaignId;
  const campaigns = listCampaigns();
  const campaign = campaigns.find((item) => item.id === requestedCampaignId) || campaigns.find((item) => item.status === "ACTIVE") || campaigns[0];
  const organizations = campaign ? listOrganizations(campaign.id).filter((organization) => organization.evidence.some((evidence) => evidence.sourceProvider === "授权简历")) : [];
  const intelligence = Object.fromEntries(organizations.map((organization) => [organization.organizationId, {
    projects: listProjects(organization.organizationId),
    claims: listEvidenceClaims(organization.organizationId),
    sources: listIntelligenceSources(organization.organizationId),
    events: listOrganizationEvents(organization.organizationId),
  }]));
  return <>
    <PageIntro eyebrow="Company Intelligence" title="公司发现" description={`当前战役：${campaign?.name || "暂无"}。AI 自主沉淀公司业务历史、当前业务与经营状态信号，并保留原始简历证据。`} />
    <div className="compliance-note" style={{ marginTop: 0, marginBottom: 16 }}><BrainCircuit size={18} /><div><strong>AI 自主入库</strong><br />已授权简历中的公司事实自动进入业务画像；推断与事实分开展示，证据不足时保留为未知。</div></div>
    {organizations.length ? <OrganizationWorkbench key={initialQuery} organizations={organizations} intelligence={intelligence} initialQuery={initialQuery} canManage={hasPermission(user, "organizations.manage")} canResearch={hasPermission(user, "intelligence.manage")} /> : <div className="panel"><div className="empty-state"><Building2 size={28} /><strong>还没有从简历中发现公司</strong><p>先在简历库新增授权简历，再到 AI 学习中心运行增量学习。</p></div></div>}
  </>;
}
