"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, CheckCircle2, Circle, LoaderCircle, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import type { AiRun, Campaign } from "@/lib/types";

const activeStatuses = new Set<AiRun["status"]>(["QUEUED", "RUNNING"]);
const terminalStatuses = new Set<AiRun["status"]>(["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"]);
const stageLabels: Record<string, string> = {
  QUEUED: "等待后台领取任务",
  ANALYZE_RESUMES: "正在分析简历并更新候选人、公司与关系图谱",
  GENERATE_SEARCH_TASKS: "正在根据图谱生成新的 BOSS 搜索任务",
  COMPLETED: "学习任务已完成",
};

function metric(run: AiRun, key: string) {
  const value = Number(run.metrics[key]);
  return Number.isFinite(value) ? value : 0;
}

function progressFor(run: AiRun) {
  if (terminalStatuses.has(run.status)) return 100;
  if (run.stage === "GENERATE_SEARCH_TASKS") return 92;
  if (run.stage === "ANALYZE_RESUMES") {
    const total = metric(run, "inputResumes");
    return total ? Math.min(86, Math.round(10 + (metric(run, "processed") / total) * 76)) : 82;
  }
  return 5;
}

function replaceRun(runs: AiRun[], next: AiRun) {
  return [next, ...runs.filter((run) => run.id !== next.id)].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function LearningControls({ campaigns, initialRuns }: { campaigns: Campaign[]; initialRuns: AiRun[] }) {
  const router = useRouter();
  const initialActive = initialRuns.find((run) => activeStatuses.has(run.status) && run.campaignId);
  const [campaignId, setCampaignId] = useState(initialActive?.campaignId || campaigns[0]?.id || "");
  const [runs, setRuns] = useState(initialRuns);
  const [launching, setLaunching] = useState<"MANUAL" | "REBUILD" | null>(null);
  const [message, setMessage] = useState("");
  const startedRuns = useRef(new Set<string>());
  const finishedRuns = useRef(new Set<string>());

  const activeRun = useMemo(
    () => runs.find((run) => run.campaignId === campaignId && activeStatuses.has(run.status)),
    [campaignId, runs],
  );
  const activeRunId = activeRun?.id || "";
  const activeRunStatus = activeRun?.status || null;

  const executeRun = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/ai-runs/${runId}`, { method: "POST", keepalive: true });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "学习任务启动失败");
      setRuns((current) => replaceRun(current, result.data as AiRun));
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message}；任务已保留，可返回本页继续。` : "学习任务启动失败；任务已保留，可返回本页继续。");
    }
  }, []);

  useEffect(() => {
    if (!activeRunId || activeRunStatus !== "QUEUED" || startedRuns.current.has(activeRunId)) return;
    startedRuns.current.add(activeRunId);
    void executeRun(activeRunId);
  }, [activeRunId, activeRunStatus, executeRun]);

  useEffect(() => {
    if (!activeRunId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/ai-runs/${activeRunId}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "无法获取学习进度");
        if (stopped) return;
        const next = result.data as AiRun;
        setRuns((current) => replaceRun(current, next));
        if (terminalStatuses.has(next.status) && !finishedRuns.current.has(next.id)) {
          finishedRuns.current.add(next.id);
          setMessage(next.errorMessage || next.summary);
          router.refresh();
        }
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : "无法获取学习进度");
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeRunId, router]);

  async function run(runType: "MANUAL" | "REBUILD") {
    setLaunching(runType);
    setMessage("");
    try {
      const response = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, runType, queueOnly: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI 学习任务创建失败");
      setRuns((current) => replaceRun(current, result.data as AiRun));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 学习任务创建失败");
    } finally {
      setLaunching(null);
    }
  }

  const busy = Boolean(launching || activeRun);
  const progress = activeRun ? progressFor(activeRun) : 0;
  const processed = activeRun ? metric(activeRun, "processed") : 0;
  const total = activeRun ? metric(activeRun, "inputResumes") : 0;
  const analyzeDone = activeRun?.stage === "GENERATE_SEARCH_TASKS" || activeRun?.stage === "COMPLETED";

  return <div className="learning-controls">
    <div className="toolbar">
      <select className="select" aria-label="选择人才画像" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
      <button className="button primary" onClick={() => run("MANUAL")} disabled={busy}>{launching === "MANUAL" || activeRun?.runType === "MANUAL" ? <LoaderCircle className="spin" size={16} /> : <BrainCircuit size={16} />}{activeRun?.runType === "MANUAL" ? "增量学习中" : "增量学习"}</button>
      <button className="button" onClick={() => run("REBUILD")} disabled={busy} title="重新分析该画像的全部简历">{launching === "REBUILD" || activeRun?.runType === "REBUILD" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{activeRun?.runType === "REBUILD" ? "正在重建" : "重建图谱"}</button>
      {message && !activeRun ? <span className="toolbar-message">{message}</span> : null}
    </div>

    {activeRun ? <div className="learning-progress" aria-live="polite">
      <div className="learning-progress-head">
        <span className="learning-progress-icon"><LoaderCircle className="spin" size={17} /></span>
        <div><strong>{activeRun.runType === "REBUILD" ? "正在重建人才与公司图谱" : "正在进行增量学习"}</strong><p>{stageLabels[activeRun.stage] || activeRun.summary}</p></div>
        <StatusBadge status={activeRun.status} label={activeRun.status === "QUEUED" ? "排队中" : "运行中"} />
      </div>
      <div className="progress-label"><span>{activeRun.stage === "ANALYZE_RESUMES" && total ? `已处理 ${processed} / ${total} 份简历` : activeRun.summary}</span><strong>{progress}%</strong></div>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ width: `${progress}%` }} /></div>
      <ol className="learning-progress-steps">
        <li className="done"><CheckCircle2 size={14} /><span>创建任务</span></li>
        <li className={activeRun.stage === "ANALYZE_RESUMES" ? "active" : analyzeDone ? "done" : ""}>{analyzeDone ? <CheckCircle2 size={14} /> : <LoaderCircle className="spin" size={14} />}<span>分析简历与更新图谱</span></li>
        <li className={activeRun.stage === "GENERATE_SEARCH_TASKS" ? "active" : ""}>{activeRun.stage === "GENERATE_SEARCH_TASKS" ? <LoaderCircle className="spin" size={14} /> : <Circle size={14} />}<span>生成搜索任务</span></li>
      </ol>
      {message ? <p className="learning-progress-note">{message}</p> : null}
    </div> : null}
  </div>;
}
