import { BrainCircuit, Clock3, GitBranch, SearchCheck } from "lucide-react";
import { LearningControls } from "@/components/learning-controls";
import { EmptyState, Metric, PageIntro, StatusBadge } from "@/components/ui";
import { learningOverview, listAiRuns, listLearningRecommendations } from "@/lib/learning";
import { listCampaigns } from "@/lib/repository";
import { hasPermission, requirePagePermission } from "@/lib/auth";
import { AutonomyWorkbench } from "@/components/autonomy-workbench";
import { autonomyOverview, ensureActiveStrategyVersion, listExperiments, listResearchTasks, listReviewRuns, listStrategyVersions } from "@/lib/autonomy";

export const dynamic = "force-dynamic";

const runLabels: Record<string, string> = { QUEUED: "排队中", RUNNING: "运行中", SUCCEEDED: "成功", PARTIAL_SUCCESS: "部分成功", FAILED: "失败", CANCELLED: "已取消" };

export default async function LearningPage() {
  const user = await requirePagePermission("learning.view");
  const campaigns = listCampaigns();
  const overview = learningOverview();
  const runs = listAiRuns();
  const recommendations = listLearningRecommendations();
  campaigns.filter((campaign) => campaign.status === "ACTIVE").forEach((campaign) => ensureActiveStrategyVersion(campaign.id));
  const autonomy = autonomyOverview();
  const reviews = listReviewRuns();
  const strategies = listStrategyVersions();
  const experiments = listExperiments();
  const researchTasks = listResearchTasks();
  return <>
    <PageIntro eyebrow="Controlled Learning Loop" title="AI 学习中心" description="每天 00:00 自动处理新增或变化简历；也可手动触发。模型负责抽取和提出建议，系统只自动更新有上下限的搜索权重。" />
    <div className="metrics-grid">
      <Metric icon={BrainCircuit} label="待学习简历" value={overview.pendingResumes} detail={`简历库 ${overview.resumes} 份 · 质量隔离 ${overview.quarantinedResumes} 份`} />
      <Metric icon={GitBranch} label="可追溯事件" value={autonomy.trackedEvents} detail={`${autonomy.activeStrategies} 个生效策略 · ${autonomy.runningExperiments} 个实验`} tone="blue" />
      <Metric icon={SearchCheck} label="情报与搜索任务" value={autonomy.pendingResearch + overview.openSearchTasks} detail={`${autonomy.projects} 个竞品项目 · ${autonomy.promotedClaims} 条正式事实`} tone="amber" />
      <Metric icon={Clock3} label="反馈样本" value={overview.feedbackSamples} detail={`${autonomy.disputedClaims} 条冲突 · ${autonomy.staleClaims} 条过期`} tone="purple" />
    </div>
    <section className="section"><div className="section-head"><div><h3>AI 自主经营闭环</h3><p>复盘、策略、实验和公开研究均保留版本、来源与回滚记录</p></div></div><AutonomyWorkbench campaigns={campaigns} reviews={reviews} strategies={strategies} experiments={experiments} researchTasks={researchTasks} canManage={hasPermission(user, "reviews.manage")} /></section>
    {hasPermission(user, "learning.manage") ? <section className="section"><div className="section-head"><div><h3>运行学习</h3><p>增量学习只处理新数据；重建图谱会重新分析该画像的全部简历</p></div></div><LearningControls campaigns={campaigns} initialRuns={runs} /></section> : null}
    <div className="content-grid learning-grid"><section className="section"><div className="section-head"><div><h3>运行记录</h3><p>输入、阶段、失败项和输出指标均可审计</p></div></div><div className="panel">{runs.map((run) => <div className="data-row" key={run.id}><div className="row-icon"><BrainCircuit size={18} /></div><div className="row-main"><strong>{run.runType} · {run.campaignName || "全部画像"}</strong><span>{run.summary}</span>{run.errorMessage ? <em className="row-error">{run.errorMessage}</em> : null}</div><div className="row-meta">{new Date(run.createdAt).toLocaleString("zh-CN")}</div><StatusBadge status={run.status} label={runLabels[run.status] || run.status} /></div>)}{!runs.length ? <EmptyState icon={BrainCircuit} title="尚未运行学习" description="导入简历后，运行一次增量学习即可生成图谱和搜索任务。" /> : null}</div></section>
      <section className="section"><div className="section-head"><div><h3>学习建议</h3><p>至少 3 次结果反馈后生成</p></div></div><div className="panel">{recommendations.map((item) => <div className="recommendation" key={item.id}><div><strong>{item.title}</strong><span>可信度 {Math.round(item.confidence * 100)}%</span></div><p>{item.reason}</p><StatusBadge status={item.status} label={item.status === "PENDING_REVIEW" ? "待审核" : item.status} /></div>)}{!recommendations.length ? <EmptyState icon={SearchCheck} title="样本还不够" description="HR 完成搜索任务并填写有效沟通结果后，系统会逐步形成可审核建议。" /> : null}</div></section></div>
  </>;
}
