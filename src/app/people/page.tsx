import { UserRoundSearch } from "lucide-react";
import { PersonWorkbench } from "@/components/person-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listPeople } from "@/lib/repository";
import { hasPermission, requirePagePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; campaignId?: string | string[]; status?: string | string[]; stage?: string | string[] }> }) {
  const user = await requirePagePermission("people.view");
  const params = await searchParams;
  const rawQuery = params.q;
  const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "";
  const requestedCampaignId = Array.isArray(params.campaignId) ? params.campaignId[0] : params.campaignId;
  const initialStatus = Array.isArray(params.status) ? params.status[0] : params.status || "ALL";
  const initialStage = Array.isArray(params.stage) ? params.stage[0] : params.stage || "ALL";
  const campaigns = listCampaigns();
  const campaign = campaigns.find((item) => item.id === requestedCampaignId) || campaigns.find((item) => item.status === "ACTIVE") || campaigns[0];
  const people = campaign ? listPeople(campaign.id) : [];
  return <>
    <PageIntro eyebrow="Campaign Talent Pipeline" title="候选人推进" description={`当前战役：${campaign?.name || "暂无"}。从审核、触达到有效沟通、面试、Offer 和入职，全程保留状态与原因记录。`} />
    {people.length ? <PersonWorkbench key={`${campaign?.id}-${initialQuery}-${initialStatus}-${initialStage}`} people={people} campaigns={campaigns.map(({ id, name }) => ({ id, name }))} currentCampaignId={campaign?.id} initialQuery={initialQuery} initialStatus={initialStatus} initialStage={initialStage} canManage={hasPermission(user, "people.manage")} /> : <div className="panel"><div className="empty-state"><UserRoundSearch size={28} /><strong>还没有候选人</strong><p>请先在简历库新增授权简历并运行增量学习。</p></div></div>}
  </>;
}
