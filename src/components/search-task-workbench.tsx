"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, LoaderCircle, MessageSquareText, Search } from "lucide-react";
import type { SearchTask } from "@/lib/types";

export function SearchTaskWorkbench({ tasks, initialQuery = "" }: { tasks: SearchTask[]; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => tasks.filter((task) => [task.title, task.companyName, task.campaignName, ...task.query.keywords, ...task.query.locations].join(" ").toLowerCase().includes(query.trim().toLowerCase())), [query, tasks]);
  async function copy(task: SearchTask) {
    await navigator.clipboard.writeText([task.companyName, task.query.keywords[0], task.query.locations[0]].filter(Boolean).join(" "));
    setCopied(task.id); window.setTimeout(() => setCopied(null), 1500);
  }
  async function begin(task: SearchTask) {
    await fetch(`/api/search-tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "IN_PROGRESS", claimedBy: "当前用户" }) });
    setActive(task.id); router.refresh();
  }
  async function feedback(taskId: string, formData: FormData) {
    setLoading(true); setMessage("");
    const response = await fetch("/api/search-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, resultCount: formData.get("resultCount"), qualifiedCount: formData.get("qualifiedCount"), effectiveConversations: formData.get("effectiveConversations"), note: formData.get("note") }) });
    const result = await response.json();
    setLoading(false);
    setMessage(response.ok ? `反馈已计入学习，${result.data.learning.companyName} 当前权重 ${result.data.learning.weight}` : result.error);
    if (response.ok) { setActive(null); router.refresh(); }
  }
  return <div className="task-workbench">
    <div className="toolbar"><div className="search-field"><Search size={15} /><input aria-label="搜索 BOSS 任务" placeholder="搜索公司、职位或关键词" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
    {filtered.map((task) => <article className="search-task" key={task.id}>
      <div className="search-task-main">
        <div className="priority-box"><strong>{task.priority}</strong><span>优先级</span></div>
        <div className="search-task-content"><div className="search-task-title"><div><h3>{task.title}</h3><p>{task.campaignName} · {task.reason.summary}</p></div><span className={`status-badge status-${task.status.toLowerCase().replaceAll("_", "-")}`}><i />{task.status}</span></div>
          <div className="tag-row">{task.query.keywords.map((keyword) => <span className="tag" key={keyword}>{keyword}</span>)}{task.query.locations.map((location) => <span className="tag" key={location}>{location}</span>)}</div>
          <ol className="compact-steps">{task.query.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
          <div className="task-command-row"><button className="button small" onClick={() => copy(task)}>{copied === task.id ? <Check size={14} /> : <Clipboard size={14} />}{copied === task.id ? "已复制" : "复制搜索词"}</button><a className="button small" href="https://www.zhipin.com/web/geek/job" target="_blank" rel="noreferrer"><ExternalLink size={14} />打开 BOSS</a><button className="button primary small" onClick={() => begin(task)}><MessageSquareText size={14} />记录结果</button></div>
        </div>
      </div>
      {active === task.id ? <form className="feedback-form" action={(formData) => feedback(task.id, formData)}>
        <div className="form-grid"><div className="field"><label>搜索结果数</label><input name="resultCount" type="number" min="0" defaultValue="0" required /></div><div className="field"><label>符合画像数</label><input name="qualifiedCount" type="number" min="0" defaultValue="0" required /></div><div className="field"><label>有效沟通数</label><input name="effectiveConversations" type="number" min="0" defaultValue="0" required /></div><div className="field"><label>备注</label><input name="note" placeholder="关键词偏差、公司别名等" /></div></div>
        <div className="form-actions"><button type="button" className="button" onClick={() => setActive(null)}>取消</button><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}提交并学习</button></div>
      </form> : null}
    </article>)}
    {!filtered.length ? <div className="empty-state"><Search size={28} /><strong>{tasks.length ? "没有符合搜索条件的任务" : "暂时没有搜索任务"}</strong><p>{tasks.length ? "调整公司、职位或关键词。" : "先导入简历并运行 AI 增量学习，系统会根据公司图谱生成下一批 BOSS 搜索词。"}</p></div> : null}
    {message ? <div className="toast"><Check size={17} />{message}</div> : null}
  </div>;
}
