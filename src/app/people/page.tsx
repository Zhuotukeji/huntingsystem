import { UserRoundSearch } from "lucide-react";
import { PersonWorkbench } from "@/components/person-workbench";
import { PageIntro } from "@/components/ui";
import { listCampaigns, listPeople } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const campaign = listCampaigns().find((item) => item.status === "ACTIVE") || listCampaigns()[0];
  const people = campaign ? listPeople(campaign.id) : [];
  return <>
    <PageIntro eyebrow="People Intelligence" title="候选人证据队列" description={`当前战役：${campaign?.name || "暂无"}。候选人来自授权简历学习，事实、AI 判断和未知项分开呈现。`} />
    {people.length ? <PersonWorkbench people={people} /> : <div className="panel"><div className="empty-state"><UserRoundSearch size={28} /><strong>还没有候选人</strong><p>请先在简历库新增授权简历并运行增量学习。</p></div></div>}
  </>;
}
