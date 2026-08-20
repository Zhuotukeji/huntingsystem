import { CheckCircle2, ClipboardList, MessageSquareText, Search } from "lucide-react";
import { SearchTaskWorkbench } from "@/components/search-task-workbench";
import { Metric, PageIntro } from "@/components/ui";
import { listSearchTasks } from "@/lib/learning";

export const dynamic = "force-dynamic";

export default async function SearchTasksPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const rawQuery = (await searchParams).q;
  const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "";
  const tasks = listSearchTasks();
  const open = tasks.filter((task) => ["NEW", "CLAIMED", "IN_PROGRESS"].includes(task.status));
  return <>
    <PageIntro eyebrow="BOSS Search Workbench" title="BOSS 搜索任务" description="系统根据简历图谱生成公司、职位和地区组合，HR 在 BOSS 网页版手工执行。结果反馈直接进入下一轮搜索权重学习。" />
    <div className="metrics-grid">
      <Metric icon={ClipboardList} label="全部任务" value={tasks.length} detail="按画像、公司和周期去重" />
      <Metric icon={Search} label="待执行" value={open.length} detail="优先级高的任务在前" tone="blue" />
      <Metric icon={CheckCircle2} label="已完成" value={tasks.filter((task) => task.status === "COMPLETED").length} detail="至少发现 1 名合格人选" tone="amber" />
      <Metric icon={MessageSquareText} label="有效沟通" value="反馈口径" detail="合格且完成实质双向沟通" tone="purple" />
    </div>
    <section className="section"><div className="section-head"><div><h3>执行队列</h3><p>复制搜索词、打开 BOSS、人工筛选并回填结果</p></div></div><SearchTaskWorkbench key={initialQuery} tasks={open} initialQuery={initialQuery} /></section>
  </>;
}
