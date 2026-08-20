import { Building2, GitBranch, Network, Users } from "lucide-react";
import { GraphExplorer } from "@/components/graph-explorer";
import { Metric, PageIntro } from "@/components/ui";
import { getGraphData } from "@/lib/learning";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  const graph = getGraphData();
  return <>
    <PageIntro eyebrow="Evidence Graph" title="公司与人才图谱" description="从简历中的任职和技能证据建立关系。每条边都能追溯到来源简历，未知信息不会被补写成事实。" />
    <div className="metrics-grid">
      <Metric icon={Users} label="人才节点" value={graph.metrics.people} detail="来自已分析的授权简历" />
      <Metric icon={Building2} label="公司节点" value={graph.metrics.organizations} detail="由任职经历反向发现" tone="blue" />
      <Metric icon={GitBranch} label="技能节点" value={graph.metrics.skills} detail="带简历证据与可信度" tone="amber" />
      <Metric icon={Network} label="证据关系" value={graph.metrics.evidenceBackedEdges} detail="任职关系与技能关系" tone="purple" />
    </div>
    <section className="section"><div className="section-head"><div><h3>关系浏览</h3><p>搜索任意节点会保留与其直接相连的上下文</p></div></div><GraphExplorer graph={graph} /></section>
    <section className="section"><div className="section-head"><div><h3>公司人才密度</h3><p>用于判断下一轮优先深挖哪些公司</p></div></div><div className="panel">
      <table className="entity-table graph-table"><thead><tr><th>公司</th><th>关联人才</th><th>目标岗位关系</th><th>画像分</th><th>依据</th></tr></thead><tbody>{graph.companyInsights.map((company) => <tr key={company.organizationId}><td className="cell-title"><strong>{company.name}</strong></td><td>{company.talentCount}</td><td>{company.targetRoleCount}</td><td><strong>{company.score}</strong></td><td>{company.reasons.join("；")}</td></tr>)}</tbody></table>
      {!graph.companyInsights.length ? <div className="empty-state"><Network size={28} /><strong>暂无公司洞察</strong><p>分析简历后，这里会显示公司的人才密度和负责人岗位覆盖。</p></div> : null}
    </div></section>
  </>;
}
