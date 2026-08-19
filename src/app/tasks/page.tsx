import { Activity } from "lucide-react";
import { PageIntro } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import { listTasks } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  const tasks = listTasks();
  return <><PageIntro eyebrow="Agent Operations" title="智能体任务" description="查看每次发现和解析的状态、步骤与结果。失败任务可人工重试，外部来源中断不会影响已有数据。" /><div className="compliance-note" style={{ marginTop: 0, marginBottom: 16 }}><Activity size={18} /><div><strong>当前运行模式</strong><br />未配置模型密钥时使用确定性演示智能体，便于本地验收。接入合规模型后仍使用同一任务、证据和人工审核契约。</div></div><TaskList tasks={tasks} /></>;
}
