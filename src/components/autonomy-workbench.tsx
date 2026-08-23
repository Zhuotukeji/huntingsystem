"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Beaker, BrainCircuit, CheckCircle2, FlaskConical, Globe2, History, LoaderCircle, Play, RotateCcw, ShieldCheck } from "lucide-react";
import type { Campaign, Experiment, ResearchTask, ReviewRun, StrategyVersion } from "@/lib/types";
import { EmptyState, StatusBadge } from "@/components/ui";

type Tab = "reviews" | "strategies" | "experiments" | "runs";

export function AutonomyWorkbench({ campaigns, reviews, strategies, experiments, researchTasks, canManage }: {
  campaigns: Campaign[];
  reviews: ReviewRun[];
  strategies: StrategyVersion[];
  experiments: Experiment[];
  researchTasks: ResearchTask[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("reviews");
  const [campaignId, setCampaignId] = useState(campaigns.find((item) => item.status === "ACTIVE")?.id || campaigns[0]?.id || "");
  const [loading, setLoading] = useState("");
  const [message, setMessage] = useState("");
  const filteredReviews = useMemo(() => reviews.filter((item) => !campaignId || item.campaignId === campaignId), [reviews, campaignId]);
  const filteredStrategies = useMemo(() => strategies.filter((item) => !campaignId || item.campaignId === campaignId), [strategies, campaignId]);
  const filteredExperiments = useMemo(() => experiments.filter((item) => !campaignId || item.campaignId === campaignId), [experiments, campaignId]);

  async function runReview(reviewType: "DAILY" | "WEEKLY") {
    if (!campaignId) return;
    setLoading(`review-${reviewType}`); setMessage("");
    const response = await fetch("/api/review-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, reviewType }) });
    const result = await response.json();
    setLoading(""); setMessage(response.ok ? `${reviewType === "DAILY" ? "每日" : "每周"}复盘已完成` : result.error);
    if (response.ok) router.refresh();
  }

  async function activateStrategy(id: string) {
    setLoading(`strategy-${id}`); setMessage("");
    const response = await fetch(`/api/strategy-versions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ACTIVE" }) });
    const result = await response.json(); setLoading(""); setMessage(response.ok ? "策略版本已激活" : result.error);
    if (response.ok) router.refresh();
  }

  async function updateExperiment(id: string, status: Experiment["status"]) {
    setLoading(`experiment-${id}`); setMessage("");
    const response = await fetch(`/api/experiments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json(); setLoading(""); setMessage(response.ok ? "实验状态已更新" : result.error);
    if (response.ok) router.refresh();
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Activity; count: number }> = [
    { id: "reviews", label: "复盘", icon: BrainCircuit, count: filteredReviews.length },
    { id: "strategies", label: "策略版本", icon: History, count: filteredStrategies.length },
    { id: "experiments", label: "实验", icon: FlaskConical, count: filteredExperiments.length },
    { id: "runs", label: "研究运行", icon: Globe2, count: researchTasks.length },
  ];

  return <div className="autonomy-workbench">
    <div className="autonomy-toolbar">
      <div className="segmented-control" role="tablist">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={14} />{item.label}<span>{item.count}</span></button>; })}</div>
      <div className="autonomy-actions"><select className="select" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select>{canManage && tab === "reviews" ? <><button className="button small" disabled={Boolean(loading)} onClick={() => runReview("DAILY")}><Activity size={14} />每日复盘</button><button className="button small primary" disabled={Boolean(loading)} onClick={() => runReview("WEEKLY")}><BrainCircuit size={14} />每周复盘</button></> : null}</div>
    </div>
    {message ? <div className="inline-feedback"><CheckCircle2 size={15} />{message}</div> : null}

    {tab === "reviews" ? <div className="panel autonomy-list">{filteredReviews.map((review) => <article className="autonomy-row" key={review.id}><div className="autonomy-icon"><BrainCircuit size={17} /></div><div className="autonomy-main"><div><strong>{review.reviewType === "DAILY" ? "每日执行复盘" : review.reviewType === "WEEKLY" ? "28 天策略复盘" : "人工复盘"}</strong><StatusBadge status={review.status} label={review.status === "SUCCEEDED" ? "已完成" : review.status} /></div><p>{review.diagnosis.join(" ")}</p><div className="metric-chips"><span>{review.metrics.completedTasks || 0} 个任务</span><span>{review.metrics.searchResults || 0} 个结果</span><span>{review.metrics.qualifiedCandidates || 0} 个高质量人选</span><span>{review.metrics.effectiveConversations || 0} 次有效沟通</span><span>应用 {review.appliedChanges.length} 项</span></div></div><time>{new Date(review.createdAt).toLocaleString("zh-CN")}</time></article>)}{!filteredReviews.length ? <EmptyState icon={BrainCircuit} title="尚无复盘记录" description="运行每日复盘检查执行质量，达到样本门槛后再运行每周策略复盘。" /> : null}</div> : null}

    {tab === "strategies" ? <div className="panel autonomy-list">{filteredStrategies.map((strategy) => <article className="autonomy-row" key={strategy.id}><div className="autonomy-icon"><History size={17} /></div><div className="autonomy-main"><div><strong>策略 V{strategy.version}</strong><StatusBadge status={strategy.status} label={strategy.status === "ACTIVE" ? "当前生效" : strategy.status === "SUPERSEDED" ? "历史版本" : strategy.status} /></div><p>{strategy.changeSummary}</p><div className="metric-chips"><span>{strategy.strategy.targetOrganizations.length} 家目标公司</span><span>{strategy.strategy.keywordGroups.length} 组关键词</span><span>{strategy.strategy.explorationPercent}% 探索</span><span>最大调整 {strategy.strategy.constraints.maximumWeightDelta}</span></div></div>{canManage && strategy.status !== "ACTIVE" ? <button className="icon-button" title="激活该策略版本" disabled={Boolean(loading)} onClick={() => activateStrategy(strategy.id)}>{loading === `strategy-${strategy.id}` ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}</button> : <ShieldCheck size={16} color="#668078" />}</article>)}{!filteredStrategies.length ? <EmptyState icon={History} title="尚无策略版本" description="下次生成搜索任务时会自动建立首个策略版本。" /> : null}</div> : null}

    {tab === "experiments" ? <div className="panel autonomy-list">{filteredExperiments.map((experiment) => <article className="autonomy-row" key={experiment.id}><div className="autonomy-icon"><Beaker size={17} /></div><div className="autonomy-main"><div><strong>{experiment.name}</strong><StatusBadge status={experiment.status} label={experiment.status === "RUNNING" ? "运行中" : experiment.status === "DRAFT" ? "草稿" : experiment.status} /></div><p>{experiment.dimension} · 主指标 {experiment.primaryMetric}</p><div className="metric-chips"><span>{experiment.allocationPercent}% 探索流量</span><span>至少 {experiment.minimumTasks} 个任务</span><span>至少 {experiment.minimumResults} 个结果</span>{experiment.arms.map((arm) => <span key={arm.key}>{arm.label}</span>)}</div></div>{canManage && experiment.status === "DRAFT" ? <button className="icon-button" title="启动实验" onClick={() => updateExperiment(experiment.id, "RUNNING")}><Play size={15} /></button> : null}</article>)}{!filteredExperiments.length ? <EmptyState icon={FlaskConical} title="尚无策略实验" description="系统将在有足够基线数据后创建公司、关键词或招呼语对照实验。" /> : null}</div> : null}

    {tab === "runs" ? <div className="panel autonomy-list">{researchTasks.map((task) => <article className="autonomy-row" key={task.id}><div className="autonomy-icon"><Globe2 size={17} /></div><div className="autonomy-main"><div><strong>{task.organizationName || "公司待确认"} · {task.topic}</strong><StatusBadge status={task.status} label={task.status === "BLOCKED_CONFIGURATION" ? "配置阻断" : task.status === "SUCCEEDED" ? "已完成" : task.status} /></div><p>{task.resultSummary || task.errorMessage || `由 ${task.triggerType} 触发，等待模型联网研究。`}</p></div><time>{new Date(task.createdAt).toLocaleString("zh-CN")}</time></article>)}{!researchTasks.length ? <EmptyState icon={Globe2} title="尚无联网研究任务" description="高质量简历发现新公司或情报过期时，系统会自动创建研究任务。" /> : null}</div> : null}
  </div>;
}
