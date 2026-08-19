import { Database, FileText } from "lucide-react";
import { DiscoveryButton } from "@/components/action-button";
import { ResearchImport } from "@/components/research-import";
import { PageIntro, StatusBadge } from "@/components/ui";
import { shortDate, taskStatusLabels } from "@/lib/labels";
import { listCampaigns, listSources, listTasks } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  const campaigns = listCampaigns(); const campaign = campaigns.find((item) => item.status === "ACTIVE") || campaigns[0];
  const tasks = listTasks().filter((task) => task.type === "MANUAL_INSIGHTTRACKER_RESEARCH" && task.campaignId === campaign?.id);
  const activeTask = tasks.find((task) => task.status === "WAITING_HUMAN") || tasks[0]; const sources = listSources();
  return <>
    <PageIntro eyebrow="Human-in-the-loop" title="调研任务与资料导入" description="AI 负责把研究问题变成明确指令，HR 在授权平台完成搜索；导入后由系统提取、去重、评分并生成证据。" actions={campaign ? <DiscoveryButton campaignId={campaign.id} type="insighttracker" label="新建调研任务" /> : undefined} />
    <div className="research-layout">
      <ResearchImport campaigns={campaigns} />
      <aside className="panel panel-padded">
        <div className="section-head"><div><h3>InsightTracker 指令包</h3><p>{activeTask?.title || "尚未创建调研任务"}</p></div>{activeTask ? <StatusBadge status={activeTask.status} label={taskStatusLabels[activeTask.status]} /> : null}</div>
        {activeTask ? <><ul className="instruction-list">{activeTask.steps.map((step, index) => <li key={step}><span className="step-number">{index + 1}</span><span>{step}</span></li>)}</ul><div className="compliance-note"><Database size={17} /><div>请只导入平台条款和公司授权允许保留的资料。系统不会接管登录、验证码或执行自动抓取。</div></div></> : <p style={{ color: "#65706c", fontSize: 11 }}>点击右上角新建调研任务。</p>}
      </aside>
    </div>
    <section className="section">
      <div className="section-head"><div><h3>最近导入</h3><p>相同来源和内容哈希会自动去重</p></div></div>
      <div className="panel">
        {sources.length ? sources.map((source) => <div className="source-row" key={String(source.id)}><div className="row-main"><strong>{String(source.title)}</strong><span>{String(source.campaign_name || "未关联战役")}</span></div><span>{String(source.provider)}</span><span>{Number(source.imported_count)} 条</span><span>{shortDate(String(source.created_at))}</span></div>) : <div className="empty-state"><FileText size={28} /><strong>还没有导入资料</strong><p>上传 InsightTracker 允许导出的文件，或粘贴经过授权的公开资料。</p></div>}
      </div>
    </section>
  </>;
}
