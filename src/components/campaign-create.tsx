"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export function CampaignCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const list = (key: string) => String(form.get(key) || "").split(/[，,\n]/).map((value) => value.trim()).filter(Boolean);
    const input = {
      name: form.get("name"), roleName: form.get("roleName"), ownerName: form.get("ownerName"), businessGoal: form.get("businessGoal"), valueProposition: form.get("valueProposition"),
      locations: list("locations"), markets: list("markets"), channels: list("channels"), mustHaves: list("mustHaves"), exclusions: list("exclusions"), targetOrganizationCount: Number(form.get("targetOrganizationCount")), targetPersonCount: Number(form.get("targetPersonCount")), weeklyTarget: Number(form.get("weeklyTarget")),
    };
    const response = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) { setError(result.error); return; }
    setOpen(false); router.push(`/campaigns/${result.data.id}`); router.refresh();
  }

  return <>
    <button className="button primary" onClick={() => setOpen(true)}><Plus size={16} />新建战役</button>
    {open ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head"><h2>新建寻访战役</h2><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="关闭" title="关闭"><X size={18} /></button></div>
        <div className="modal-body">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="form-grid">
            <div className="field"><label htmlFor="campaign-name">战役名称</label><input id="campaign-name" name="name" required placeholder="例如：海外项目负责人寻访" /></div>
            <div className="field"><label htmlFor="role-name">目标岗位</label><input id="role-name" name="roleName" required placeholder="岗位中英文名称" /></div>
            <div className="field"><label htmlFor="owner">负责人</label><input id="owner" name="ownerName" defaultValue="陈晨" /></div>
            <div className="field"><label htmlFor="locations">地点</label><input id="locations" name="locations" defaultValue="广州，深圳，远程" /></div>
            <div className="field full"><label htmlFor="business-goal">6-12 个月业务目标</label><textarea id="business-goal" name="businessGoal" required placeholder="这个人入职后要实现什么业务结果？" /></div>
            <div className="field full"><label htmlFor="must-haves">必须项</label><textarea id="must-haves" name="mustHaves" required placeholder="每行或逗号分隔，例如：负责过海外业务 P&L，带过 8 人以上团队" /></div>
            <div className="field full"><label htmlFor="exclusions">排除项</label><input id="exclusions" name="exclusions" placeholder="例如：纯代运营背景，无可验证海外经历" /></div>
            <div className="field"><label htmlFor="markets">目标市场</label><input id="markets" name="markets" defaultValue="欧美，东南亚" /></div>
            <div className="field"><label htmlFor="channels">核心渠道</label><input id="channels" name="channels" defaultValue="Google，Meta，TikTok，SEO" /></div>
            <div className="field full"><label htmlFor="value-proposition">候选人价值主张</label><input id="value-proposition" name="valueProposition" placeholder="为什么优秀候选人值得加入？" /></div>
            <div className="field"><label htmlFor="target-org">目标公司数</label><input id="target-org" name="targetOrganizationCount" type="number" min="10" defaultValue="100" /></div>
            <div className="field"><label htmlFor="target-person">目标人选数</label><input id="target-person" name="targetPersonCount" type="number" min="10" defaultValue="150" /></div>
            <div className="field"><label htmlFor="weekly-target">每周高匹配有效沟通目标</label><input id="weekly-target" name="weeklyTarget" type="number" min="1" defaultValue="20" /></div>
          </div>
        </div>
        <div className="modal-foot"><button type="button" className="button" onClick={() => setOpen(false)}>取消</button><button type="submit" className="button primary" disabled={loading}>{loading ? "创建中..." : "创建并生成策略"}</button></div>
      </form>
    </div> : null}
  </>;
}
