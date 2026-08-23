import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Building2, Clock3, DatabaseZap, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { Metric, PageIntro } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth";
import { computeAnalyticsReport, defaultAnalyticsCampaignId, listAnalyticsSnapshots, normalizeAnalyticsWindow, type AnalyticsDimension } from "@/lib/analytics";
import { listCampaigns } from "@/lib/repository";

export const dynamic = "force-dynamic";

function percent(value: number | null) {
  return value === null ? "暂无" : `${value}%`;
}

function duration(value: number | null) {
  if (value === null) return "暂无";
  if (value < 24) return `${value} 小时`;
  return `${Number((value / 24).toFixed(1))} 天`;
}

function DimensionTable({ rows, empty }: { rows: AnalyticsDimension[]; empty: string }) {
  if (!rows.length) return <div className="analytics-empty">{empty}</div>;
  return <div className="table-scroll"><table className="entity-table analytics-table"><thead><tr><th>维度</th><th>任务</th><th>结果</th><th>高质量</th><th>每百结果</th><th>有效沟通</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.key}><td><strong>{row.key}</strong></td><td>{row.tasks}</td><td>{row.results}</td><td>{row.qualified}</td><td>{row.qualifiedPer100 ?? "暂无"}</td><td>{row.conversations}</td></tr>)}
  </tbody></table></div>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ campaignId?: string | string[]; windowDays?: string | string[] }> }) {
  await requirePagePermission("dashboard.view");
  const campaigns = listCampaigns();
  const params = await searchParams;
  const requestedCampaign = Array.isArray(params.campaignId) ? params.campaignId[0] : params.campaignId;
  const fallbackCampaignId = defaultAnalyticsCampaignId();
  const campaignId = campaigns.some((campaign) => campaign.id === requestedCampaign) ? requestedCampaign! : fallbackCampaignId;
  const rawWindow = Array.isArray(params.windowDays) ? params.windowDays[0] : params.windowDays;
  const windowDays = normalizeAnalyticsWindow(rawWindow);

  if (!campaignId) return <>
    <PageIntro eyebrow="Operating Analytics" title="数据分析" description="暂无可统计的寻访战役。创建并激活战役后，系统会开始记录经营指标。" />
    <div className="panel panel-padded"><Link className="button primary" href="/campaigns">创建寻访战役 <ArrowRight size={15} /></Link></div>
  </>;

  const report = computeAnalyticsReport(campaignId, windowDays);
  const snapshots = listAnalyticsSnapshots(campaignId, windowDays, 14);
  const maxFunnel = Math.max(report.search.results, report.funnel.highQuality, report.funnel.contacted, report.funnel.replied, report.funnel.interviewed, report.funnel.offered, report.funnel.hired, 1);
  const funnel = [
    { label: "搜索结果", value: report.search.results, color: "#356b9a" },
    { label: "高质量候选", value: report.funnel.highQuality, color: "#245f54" },
    { label: "已联系", value: report.funnel.contacted, color: "#a75b25" },
    { label: "有效回复", value: report.funnel.replied, color: "#6f5a89" },
    { label: "面试", value: report.funnel.interviewed, color: "#567f73" },
    { label: "Offer", value: report.funnel.offered, color: "#956d36" },
    { label: "入职", value: report.funnel.hired, color: "#17221f" },
  ];

  return <>
    <PageIntro eyebrow="Operating Analytics" title="数据分析" description={`${report.campaign.name} · 最近 ${windowDays} 天 · 数据更新至 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(report.generatedAt))}`} actions={<Link className="button" href="/learning"><Sparkles size={15} />查看 AI 复盘</Link>} />

    <form className="analytics-filter" method="GET">
      <label><span>寻访战役</span><select className="select" name="campaignId" defaultValue={campaignId}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></label>
      <label><span>统计窗口</span><select className="select" name="windowDays" defaultValue={String(windowDays)}><option value="7">最近 7 天</option><option value="28">最近 28 天</option><option value="90">最近 90 天</option></select></label>
      <button className="button primary" type="submit"><BarChart3 size={15} />更新视图</button>
    </form>

    <div className="metrics-grid analytics-metrics">
      <Metric icon={Target} label="每百结果高质量人选" value={report.search.qualifiedPer100 ?? "暂无"} detail={`${report.search.highQualityCandidates} 人 / ${report.search.results} 个搜索结果`} tone="green" />
      <Metric icon={Users} label="高质量人选有效沟通率" value={percent(report.search.highQualityToConversation.percent)} detail={`${report.search.effectiveConversations} 次有效沟通 / ${report.search.highQualityCandidates} 名高质量人选`} tone="blue" />
      <Metric icon={Clock3} label="任务至首次有效回复" value={duration(report.speed.medianHoursToFirstReply)} detail={`${report.speed.replySamples} 个可归因回复样本 · 中位数`} tone="amber" />
      <Metric icon={Activity} label="当前策略实际增益" value={report.strategy.gainPercent === null ? "样本不足" : `${report.strategy.gainPercent > 0 ? "+" : ""}${report.strategy.gainPercent}%`} detail={report.strategy.sampleMessage} tone="purple" />
    </div>

    <div className="analytics-layout">
      <section className="section">
        <div className="section-head"><div><h3>招聘转化漏斗</h3><p>结果量来自任务反馈，人选阶段按去重事件统计</p></div><Target size={17} color="#65706c" /></div>
        <div className="panel analytics-funnel">{funnel.map((item) => <div className="analytics-funnel-row" key={item.label}>
          <div><span>{item.label}</span><strong>{item.value}</strong></div><div className="analytics-funnel-track"><i style={{ width: `${Math.max((item.value / maxFunnel) * 100, item.value ? 2 : 0)}%`, background: item.color }} /></div>
        </div>)}</div>
      </section>

      <section className="section">
        <div className="section-head"><div><h3>策略版本比较</h3><p>综合高质量率与高质量人选有效沟通率</p></div><Sparkles size={17} color="#65706c" /></div>
        <div className="panel strategy-comparison">
          {[{ label: "当前策略", value: report.strategy.current }, { label: "上一策略", value: report.strategy.previous }].map((item) => <div className="strategy-version-row" key={item.label}><div><span>{item.label}</span><strong>{item.value ? `V${item.value.version}` : "暂无版本"}</strong></div><dl><div><dt>任务</dt><dd>{item.value?.tasks ?? 0}</dd></div><div><dt>结果</dt><dd>{item.value?.results ?? 0}</dd></div><div><dt>高质量</dt><dd>{item.value?.qualified ?? 0}</dd></div><div><dt>沟通</dt><dd>{item.value?.conversations ?? 0}</dd></div></dl></div>)}
          <div className={`sample-state ${report.strategy.sampleReady ? "ready" : "waiting"}`}><ShieldCheck size={16} /><span>{report.strategy.sampleMessage}</span></div>
        </div>
      </section>
    </div>

    <section className="section analytics-health-section">
      <div className="section-head"><div><h3>情报与简历质量</h3><p>事实健康度和信息闸门需要同时观察</p></div><DatabaseZap size={17} color="#65706c" /></div>
      <div className="analytics-health-grid">
        <article><Building2 size={18} /><span>正式情报覆盖</span><strong>{percent(report.intelligence.formalCoverage.percent)}</strong><small>{report.intelligence.coveredOrganizations} / {report.intelligence.organizations} 家公司</small></article>
        <article><Activity size={18} /><span>证据冲突率</span><strong>{percent(report.intelligence.conflictRate.percent)}</strong><small>{report.intelligence.disputedClaims} / {report.intelligence.totalClaims} 条结论</small></article>
        <article><Clock3 size={18} /><span>证据陈旧率</span><strong>{percent(report.intelligence.staleRate.percent)}</strong><small>{report.intelligence.staleClaims} / {report.intelligence.totalClaims} 条结论</small></article>
        <article><ShieldCheck size={18} /><span>垃圾信息拦截率</span><strong>{percent(report.resumeQuality.blockedRate.percent)}</strong><small>{report.resumeQuality.quarantined} / {report.resumeQuality.assessed} 份已评估简历</small></article>
        <article><Users size={18} /><span>优质简历误杀率</span><strong>{percent(report.resumeQuality.falseKillRate.percent)}</strong><small>{report.resumeQuality.restored} / {report.resumeQuality.reviewed} 份人工复核</small></article>
        <article><DatabaseZap size={18} /><span>数据完整度</span><strong>{report.dataQuality.score ?? "暂无"}</strong><small>反馈、归因与隔离复核综合</small></article>
      </div>
    </section>

    <div className="analytics-layout dimensions-layout">
      <section className="section"><div className="section-head"><div><h3>公司贡献</h3><p>按高质量候选人数排序</p></div></div><DimensionTable rows={report.dimensions.companies} empty="当前窗口暂无公司反馈数据" /></section>
      <section className="section"><div className="section-head"><div><h3>关键词贡献</h3><p>同一任务的职位词分别归因</p></div></div><DimensionTable rows={report.dimensions.keywords} empty="当前窗口暂无关键词反馈数据" /></section>
    </div>

    <div className="analytics-layout analytics-bottom">
      <section className="section"><div className="section-head"><div><h3>数据质量检查</h3><p>影响 AI 复盘可信度的缺口</p></div></div><div className="panel quality-panel">
        <div className="coverage-row"><span>任务反馈覆盖</span><strong>{percent(report.dataQuality.feedbackCoverage.percent)}</strong></div>
        <div className="coverage-row"><span>来源任务归因</span><strong>{percent(report.dataQuality.originAttributionCoverage.percent)}</strong></div>
        <div className="coverage-row"><span>隔离简历复核</span><strong>{percent(report.dataQuality.quarantineReviewCoverage.percent)}</strong></div>
        {report.dataQuality.issues.length ? <ul>{report.dataQuality.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <div className="sample-state ready"><ShieldCheck size={16} /><span>当前窗口未发现阻断复盘的数据缺口</span></div>}
      </div></section>
      <section className="section"><div className="section-head"><div><h3>历史快照</h3><p>Worker 每日保存 7、28、90 天窗口</p></div></div><div className="panel snapshot-list">
        {snapshots.length ? snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><time>{snapshot.businessDate}</time><span>每百结果</span><strong>{snapshot.metrics.search.qualifiedPer100 ?? "暂无"}</strong><span>沟通率</span><strong>{percent(snapshot.metrics.search.highQualityToConversation.percent)}</strong><span>完整度</span><strong>{snapshot.dataQuality.score ?? "暂无"}</strong></div>) : <div className="analytics-empty">每日 Worker 运行后将在此形成趋势基线</div>}
      </div></section>
    </div>
  </>;
}
