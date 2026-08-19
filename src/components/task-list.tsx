"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { AgentTask } from "@/lib/types";
import { shortDate, taskStatusLabels, taskTypeLabels } from "@/lib/labels";
import { StatusBadge } from "@/components/ui";

export function TaskList({ tasks }: { tasks: AgentTask[] }) {
  const router = useRouter(); const [filter, setFilter] = useState("ALL"); const [loading, setLoading] = useState<string | null>(null);
  const filtered = useMemo(() => tasks.filter((task) => filter === "ALL" || task.status === filter), [tasks, filter]);
  async function action(id: string, operation: "retry" | "cancel") { setLoading(id); await fetch(`/api/tasks/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: operation }) }); setLoading(null); router.refresh(); }
  return <>
    <div className="toolbar"><select className="select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选任务状态"><option value="ALL">全部状态</option>{Object.entries(taskStatusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><span style={{ marginLeft: "auto", color: "#8a9490", fontSize: 11 }}>共 {filtered.length} 个任务</span></div>
    <div className="panel" style={{ marginTop: 12 }}>
      {filtered.map((task) => <article className="task-card" key={task.id}><div className="task-card-head"><div className="task-card-icon"><Bot size={18} /></div><div className="task-card-title"><h3>{task.title}</h3><p>{taskTypeLabels[task.type] || task.type} · {task.campaignName || "系统任务"} · {shortDate(task.createdAt)}</p></div><StatusBadge status={task.status} label={taskStatusLabels[task.status]} /></div><p className="task-summary">{task.resultSummary}</p><ul className="task-steps">{task.steps.map((step) => <li key={step}>{step}</li>)}</ul><div className="task-actions">{["FAILED", "CANCELLED"].includes(task.status) ? <button className="button small" disabled={loading === task.id} onClick={() => action(task.id, "retry")}>{loading === task.id ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}重试</button> : null}{["QUEUED", "RUNNING", "WAITING_HUMAN"].includes(task.status) ? <button className="button small danger" disabled={loading === task.id} onClick={() => action(task.id, "cancel")}><X size={14} />取消</button> : null}</div></article>)}
    </div>
  </>;
}
