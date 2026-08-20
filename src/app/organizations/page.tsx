import { BrainCircuit, Building2 } from "lucide-react";
import { OrganizationWorkbench } from "@/components/organization-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listOrganizations } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const rawQuery = (await searchParams).q;
  const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "";
  const campaigns = listCampaigns();
  const campaign = campaigns.find((item) => item.status === "ACTIVE") || campaigns[0];
  const organizations = campaign ? listOrganizations(campaign.id).filter((organization) => organization.evidence.some((evidence) => evidence.sourceProvider === "授权简历")) : [];
  return <>
    <PageIntro eyebrow="Company Intelligence" title="公司发现" description={`当前战役：${campaign?.name || "暂无"}。公司由 AI 从授权简历的任职关系中学习产生，每条结论都保留原始简历证据。`} />
    <div className="compliance-note" style={{ marginTop: 0, marginBottom: 16 }}><BrainCircuit size={18} /><div><strong>发现机制</strong><br />新增简历完成增量学习后，公司、任职职位、市场与渠道会更新到此列表；没有简历证据的公司不会展示。</div></div>
    {organizations.length ? <OrganizationWorkbench key={initialQuery} organizations={organizations} initialQuery={initialQuery} /> : <div className="panel"><div className="empty-state"><Building2 size={28} /><strong>还没有从简历中发现公司</strong><p>先在简历库新增授权简历，再到 AI 学习中心运行增量学习。</p></div></div>}
  </>;
}
