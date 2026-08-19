"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import type { Campaign } from "@/lib/types";

export function ResearchImport({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [text, setText] = useState(""); const [fileName, setFileName] = useState(""); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { setError("V1 单个文件不能超过 2 MB"); return; }
    setFileName(file.name); setText(await file.text()); setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: form.get("campaignId"), provider: form.get("provider"), title: form.get("title") || fileName || "人工调研资料", sourceUrl: form.get("sourceUrl"), text }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) { setError(result.error); return; }
    setMessage(result.data.duplicate ? "相同内容已经导入，本次已自动跳过" : `导入完成，新增 ${result.data.imported} 家公司`); setText(""); setFileName(""); router.refresh(); window.setTimeout(() => setMessage(""), 4200);
  }
  return <form className="research-form" onSubmit={submit}>
    <h3>导入调研资料</h3><p>支持平台允许导出的 CSV/TSV，或粘贴链接和原文摘录。CSV 首行可使用 company、website、location、product、market、channel、monetization、evidence。</p>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="form-grid">
      <div className="field"><label htmlFor="import-campaign">归属战役</label><select id="import-campaign" name="campaignId" required>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></div>
      <div className="field"><label htmlFor="provider">资料来源</label><select id="provider" name="provider"><option>InsightTracker</option><option>BOSS 直聘人工线索</option><option>公开网页</option><option>其他授权来源</option></select></div>
      <div className="field"><label htmlFor="import-title">资料标题</label><input id="import-title" name="title" placeholder="例如：东南亚广告产品 Top 20" defaultValue={fileName} /></div>
      <div className="field"><label htmlFor="source-url">原始链接（可选）</label><input id="source-url" name="sourceUrl" type="url" placeholder="https://" /></div>
    </div>
    <label className="file-drop"><input type="file" accept=".csv,.tsv,.txt" onChange={readFile} /><span><FileSpreadsheet size={24} /><strong>{fileName || "选择 CSV、TSV 或 TXT 文件"}</strong><span>文件仅用于当前战役的合规研究</span></span></label>
    <div className="field"><label htmlFor="research-text">文件内容或粘贴摘录</label><textarea id="research-text" value={text} onChange={(event) => setText(event.target.value)} required placeholder={'company,website,location,product,market,channel,monetization,evidence\n示例公司,example.com,广州,示例产品,东南亚,TikTok,广告,调研原文摘录'} style={{ minHeight: 150 }} /></div>
    <button className="button primary" disabled={loading || !text.trim()} style={{ marginTop: 15 }}>{loading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{loading ? "解析与去重中" : "导入并生成审核项"}</button>
    {message ? <div className="toast"><CheckCircle2 size={17} />{message}</div> : null}
  </form>;
}
