import Link from "next/link";
import { ArrowRight, Bot, Building2, Clock3, MessageSquareText, Sparkles, Target, UserCheck, Users } from "lucide-react";
import { getDashboard } from "@/lib/repository";
import { personStatusLabels, shortDate, taskStatusLabels } from "@/lib/labels";
import { Metric, PageIntro, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const data = getDashboard();
  const maxFunnel = Math.max(...data.funnel.map((item) => item.value), 1);
  return <>
    <PageIntro eyebrow="Wednesday · 19 August" title="早上好，陈晨" description={`系统已按证据质量和业务匹配度排好今天的工作。先处理 ${data.metrics.pendingCompanies + data.metrics.pendingPeople} 条待判断记录，再启动下一轮发现。`} />
    <div className="metrics-grid">
      <Metric icon={Building2} label="待审核公司" value={data.metrics.pendingCompanies} detail="优先审核高于 80 分的公司" tone="green" />
      <Metric icon={Users} label="待审核人选" value={data.metrics.pendingPeople} detail="含需要补充证据的人选" tone="blue" />
      <Metric icon={UserCheck} label="本周高匹配沟通" value={`${data.metrics.highMatchEngaged}/${data.metrics.weeklyGoal}`} detail="北极星指标 · 目标仍需基线校准" tone="amber" />
      <Metric icon={Clock3} label="预计节省时间" value={`${data.metrics.estimatedHoursSaved}h`} detail="按每份研究节省 22 分钟估算" tone="purple" />
    </div>

    <div className="content-grid">
      <div>
        <section className="section">
          <div className="section-head"><div><h3>今天优先处理</h3><p>按人工等待和业务影响排序</p></div><Link className="text-link" href="/tasks">全部任务 <ArrowRight size={12} /></Link></div>
          <div className="panel">
            <ul className="row-list">
              {data.urgentTasks.map((task) => <li className="data-row" key={task.id}>
                <div className="row-icon"><Bot size={18} /></div>
                <div className="row-main"><strong>{task.title}</strong><span>{task.resultSummary}</span></div>
                <StatusBadge status={task.status} label={taskStatusLabels[task.status]} />
                <Link className="button small" href={task.type.includes("INSIGHTTRACKER") ? "/research" : "/tasks"}>处理</Link>
              </li>)}
              {!data.urgentTasks.length ? <li className="data-row"><div className="row-icon"><Sparkles size={18} /></div><div className="row-main"><strong>今天的任务已处理完</strong><span>可进入战役启动下一轮发现</span></div></li> : null}
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><div><h3>优先人选</h3><p>综合匹配、证据覆盖和身份可信度</p></div><Link className="text-link" href="/people">进入审核队列 <ArrowRight size={12} /></Link></div>
          <div className="panel">
            {data.recentPeople.map((person) => <div className="data-row" key={person.id}>
              <div className="avatar">{person.name.slice(0, 1)}</div>
              <div className="row-main"><strong>{person.name} · {person.headline}</strong><span>{person.organizationName} · {person.location} · {person.slot}</span></div>
              <div className="row-score">{person.fitScore}</div>
              <StatusBadge status={person.status} label={personStatusLabels[person.status]} />
            </div>)}
          </div>
        </section>
      </div>

      <div>
        <section className="section">
          <div className="section-head"><div><h3>本周人才漏斗</h3><p>只计算高匹配人选</p></div><Target size={17} color="#65706c" /></div>
          <div className="panel funnel">
            {data.funnel.map((item) => <div className="funnel-row" key={item.label}><div className="funnel-label"><span>{item.label}</span><strong>{item.value}</strong></div><div className="funnel-track"><div className="funnel-fill" style={{ width: `${Math.max((item.value / maxFunnel) * 100, 2)}%`, background: item.color }} /></div></div>)}
          </div>
        </section>
        <section className="section">
          <div className="section-head"><div><h3>运行中的战役</h3><p>当前目标与进度</p></div></div>
          <div className="panel">
            {data.campaigns.filter((campaign) => campaign.status === "ACTIVE").map((campaign) => <Link href={`/campaigns/${campaign.id}`} className="data-row" key={campaign.id}>
              <div className="row-icon"><Target size={18} /></div><div className="row-main"><strong>{campaign.name}</strong><span>{campaign.organizationCount} 家公司 · {campaign.personCount} 名人选</span></div><ArrowRight size={15} color="#8a9490" />
            </Link>)}
          </div>
        </section>
        <section className="section">
          <div className="panel panel-padded"><div className="section-head"><div><h3>效率口径</h3><p>避免只追求原始沟通量</p></div><MessageSquareText size={18} color="#245f54" /></div><p style={{ margin: 0, color: "#65706c", fontSize: 11, lineHeight: 1.7 }}>高匹配有效沟通 = 达到画像门槛 + 无硬性排除项 + 候选人有效回应 + 完成实质性双向沟通。更新时间 {shortDate(new Date().toISOString())}。</p></div>
        </section>
      </div>
    </div>
  </>;
}
