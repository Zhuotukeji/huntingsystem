import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Building2, Clock3, MessageSquareText, Target, Users } from "lucide-react";
import { getDashboard } from "@/lib/repository";
import { personStatusLabels, shortDate } from "@/lib/labels";
import { Metric, PageIntro, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth";
import { computeAnalyticsReport, defaultAnalyticsCampaignId } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePagePermission("dashboard.view");
  const data = getDashboard();
  const analyticsCampaignId = defaultAnalyticsCampaignId();
  const analytics = analyticsCampaignId ? computeAnalyticsReport(analyticsCampaignId, 28) : null;
  const maxFunnel = Math.max(...data.funnel.map((item) => item.value), 1);
  const today = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return <>
    <PageIntro eyebrow={today} title="今日寻访进度" description={`系统已自主学习 ${data.metrics.learnedCompanies} 家公司，当前有 ${data.metrics.pendingPeople} 名人选等待判断或自动推进。`} actions={<Link className="button" href="/analytics"><BarChart3 size={15} />查看完整数据</Link>} />
    <div className="metrics-grid">
      <Metric icon={Target} label="每百结果高质量人选" value={analytics?.search.qualifiedPer100 ?? "暂无"} detail={`${analytics?.search.highQualityCandidates || 0} 人 / ${analytics?.search.results || 0} 个结果 · 近 28 天`} tone="green" />
      <Metric icon={Users} label="高质量人选有效沟通率" value={analytics?.search.highQualityToConversation.percent === null || !analytics ? "暂无" : `${analytics.search.highQualityToConversation.percent}%`} detail={`${analytics?.search.effectiveConversations || 0} 次有效沟通 · 近 28 天`} tone="blue" />
      <Metric icon={Clock3} label="首次有效回复中位耗时" value={analytics?.speed.medianHoursToFirstReply === null || !analytics ? "暂无" : `${analytics.speed.medianHoursToFirstReply} 小时`} detail={`${analytics?.speed.replySamples || 0} 个可归因样本`} tone="amber" />
      <Metric icon={Activity} label="当前策略实际增益" value={analytics?.strategy.gainPercent === null || !analytics ? "样本不足" : `${analytics.strategy.gainPercent > 0 ? "+" : ""}${analytics.strategy.gainPercent}%`} detail={analytics?.strategy.sampleMessage || "暂无活动战役"} tone="purple" />
    </div>

    <div className="content-grid">
      <div>
        <section className="section">
          <div className="section-head"><div><h3>今天优先处理</h3><p>公司自主入库，人选按阈值或人工推进</p></div><Link className="text-link" href="/search-tasks">BOSS 搜索任务 <ArrowRight size={12} /></Link></div>
          <div className="panel">
            <div className="data-row"><div className="row-icon"><Building2 size={18} /></div><div className="row-main"><strong>查看 AI 公司情报</strong><span>{data.metrics.learnedCompanies} 家已沉淀业务画像和简历证据</span></div><Link className="button small" href="/organizations">查看公司</Link></div>
            <div className="data-row"><div className="row-icon"><Users size={18} /></div><div className="row-main"><strong>审核候选人档案</strong><span>{data.metrics.pendingPeople} 人等待判断或补充信息</span></div><Link className="button small" href="/people">查看人选</Link></div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><div><h3>优先人选</h3><p>综合匹配、证据覆盖和身份可信度</p></div><Link className="text-link" href="/people">进入推进队列 <ArrowRight size={12} /></Link></div>
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
          <div className="section-head"><div><h3>人才推进漏斗</h3><p>按当前战役状态累计</p></div><Target size={17} color="#65706c" /></div>
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
