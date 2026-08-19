import { UserRoundSearch } from "lucide-react";
import { DiscoveryButton } from "@/components/action-button";
import { PersonWorkbench } from "@/components/person-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listPeople } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const campaign = listCampaigns().find((item) => item.status === "ACTIVE") || listCampaigns()[0];
  const people = campaign ? listPeople(campaign.id) : [];
  return <>
    <PageIntro eyebrow="People Intelligence" title="候选人证据队列" description={`当前战役：${campaign?.name || "暂无"}。公开事实、AI 推测和未知项分别展示，HR 批准后才进入联系队列。`} actions={campaign ? <DiscoveryButton campaignId={campaign.id} type="people" label="从批准公司找人" /> : undefined} />
    {people.length ? <PersonWorkbench people={people} /> : <div className="panel"><div className="empty-state"><UserRoundSearch size={28} /><strong>还没有候选人</strong><p>请先在公司发现中批准目标公司，再运行人员发现。</p></div></div>}
  </>;
}
