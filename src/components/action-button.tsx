"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, LoaderCircle, Pause, Play, Radar, Search, Sparkles } from "lucide-react";

const icons = { organizations: Radar, people: Search, insighttracker: Sparkles } as const;

export function DiscoveryButton({ campaignId, type, label, variant = "primary" }: { campaignId: string; type: keyof typeof icons; label: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const Icon = icons[type];
  async function run() {
    setLoading(true); setMessage("");
    const response = await fetch("/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, type }) });
    const result = await response.json();
    setLoading(false);
    setMessage(response.ok ? result.data.resultSummary : result.error);
    if (response.ok) router.refresh();
    window.setTimeout(() => setMessage(""), 4200);
  }
  return <><button className={`button ${variant === "primary" ? "primary" : ""}`} onClick={run} disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />}{loading ? "处理中" : label}</button>{message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}</>;
}

export function CampaignStatusButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const next = status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  async function toggle() {
    setLoading(true);
    await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    setLoading(false); router.refresh();
  }
  return <button className="button" onClick={toggle} disabled={loading}>{status === "ACTIVE" ? <Pause size={15} /> : <Play size={15} />}{status === "ACTIVE" ? "暂停战役" : "激活战役"}</button>;
}
