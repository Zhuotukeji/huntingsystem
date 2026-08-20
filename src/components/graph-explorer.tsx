"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { GraphData } from "@/lib/types";

export function GraphExplorer({ graph }: { graph: GraphData }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const seed = normalized ? new Set(graph.nodes.filter((node) => `${node.label} ${node.detail}`.toLowerCase().includes(normalized)).map((node) => node.id)) : new Set(graph.nodes.slice(0, 75).map((node) => node.id));
    const related = new Set(seed);
    for (const edge of graph.edges) if (seed.has(edge.fromId) || seed.has(edge.toId)) { related.add(edge.fromId); related.add(edge.toId); }
    const nodes = graph.nodes.filter((node) => related.has(node.id)).slice(0, 90);
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId)).slice(0, 180) };
  }, [graph, query]);
  const columns = { ORGANIZATION: visible.nodes.filter((node) => node.type === "ORGANIZATION"), PERSON: visible.nodes.filter((node) => node.type === "PERSON"), SKILL: visible.nodes.filter((node) => node.type === "SKILL") };
  const positions = new Map<string, { x: number; y: number }>();
  const place = (items: typeof visible.nodes, x: number) => items.forEach((node, index) => positions.set(node.id, { x, y: 70 + ((index + 0.5) / Math.max(items.length, 1)) * 430 }));
  place(columns.ORGANIZATION, 160); place(columns.PERSON, 500); place(columns.SKILL, 840);
  return <div className="graph-panel">
    <div className="toolbar graph-toolbar"><label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、人才或技能" /></label><span className="toolbar-message">当前显示 {visible.nodes.length} 个节点、{visible.edges.length} 条关系</span></div>
    {visible.nodes.length ? <svg className="graph-canvas" viewBox="0 0 1000 560" role="img" aria-label="公司、人才与技能关系图">
      <g className="graph-edges">{visible.edges.map((edge) => { const from = positions.get(edge.fromId); const to = positions.get(edge.toId); return from && to ? <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} opacity={Math.max(.15, edge.confidence)}><title>{edge.label} · 可信度 {Math.round(edge.confidence * 100)}%</title></line> : null; })}</g>
      {visible.nodes.map((node) => { const position = positions.get(node.id)!; const color = node.type === "PERSON" ? "#356b9a" : node.type === "ORGANIZATION" ? "#245f54" : "#a75b25"; return <g key={node.id} transform={`translate(${position.x},${position.y})`} className="graph-node"><circle r={node.type === "PERSON" ? 12 : 10} fill={color}><title>{node.label} · {node.detail}</title></circle><text x={node.type === "SKILL" ? 17 : -17} y="4" textAnchor={node.type === "SKILL" ? "start" : "end"}>{node.label.length > 14 ? `${node.label.slice(0, 14)}…` : node.label}</text></g>; })}
      <g className="graph-labels"><text x="160" y="28">公司</text><text x="500" y="28">人才</text><text x="840" y="28">技能</text></g>
    </svg> : <div className="empty-state"><Search size={28} /><strong>还没有可展示的关系</strong><p>导入第一批授权简历并运行增量学习后，关系会出现在这里。</p></div>}
  </div>;
}
