"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrainCircuit, LoaderCircle, RefreshCw } from "lucide-react";
import type { Campaign } from "@/lib/types";

export function LearningControls({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id || "");
  const [loading, setLoading] = useState<"incremental" | "rebuild" | null>(null);
  const [message, setMessage] = useState("");
  async function run(runType: "MANUAL" | "REBUILD") {
    setLoading(runType === "REBUILD" ? "rebuild" : "incremental"); setMessage("");
    const response = await fetch("/api/ai-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, runType }) });
    const result = await response.json();
    setLoading(null);
    setMessage(response.ok ? result.data.summary : result.error);
    if (response.ok) router.refresh();
  }
  return <div className="toolbar">
    <select className="select" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
    <button className="button primary" onClick={() => run("MANUAL")} disabled={Boolean(loading)}>{loading === "incremental" ? <LoaderCircle className="spin" size={16} /> : <BrainCircuit size={16} />}增量学习</button>
    <button className="button" onClick={() => run("REBUILD")} disabled={Boolean(loading)} title="重新分析该画像的全部简历">{loading === "rebuild" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}重建图谱</button>
    {message ? <span className="toolbar-message">{message}</span> : null}
  </div>;
}
