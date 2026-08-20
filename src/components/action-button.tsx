"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pause, Play } from "lucide-react";

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
