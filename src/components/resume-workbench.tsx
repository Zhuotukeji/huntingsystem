"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, LoaderCircle, Play, Upload } from "lucide-react";
import type { Campaign } from "@/lib/types";

export function ResumeWorkbench({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [runNow, setRunNow] = useState(true);

  async function submit(formData: FormData) {
    setLoading(true); setMessage("");
    try {
      let response: Response;
      if (mode === "file") {
        response = await fetch("/api/resumes", { method: "POST", body: formData });
      } else {
        response = await fetch("/api/resumes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: formData.get("campaignId"), fileName: formData.get("fileName") || "粘贴简历.txt",
            rawText: formData.get("rawText"), sourceType: formData.get("sourceType"), legalBasis: formData.get("legalBasis"), createdBy: "当前用户",
          }),
        });
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "导入失败");
      const duplicate = result.data.duplicate;
      if (runNow && !duplicate) {
        const runResponse = await fetch("/api/ai-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: formData.get("campaignId"), resumeIds: [result.data.resume.id] }) });
        const runResult = await runResponse.json();
        if (!runResponse.ok) throw new Error(runResult.error || "简历已导入，但 AI 学习失败");
        setMessage(runResult.data.summary);
      } else setMessage(duplicate ? "相同简历已存在，本次未重复写入。" : "简历已进入待学习队列。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally { setLoading(false); }
  }

  return <form className="resume-import-form" action={submit}>
    <div className="segmented wide-segment" aria-label="导入方式">
      <button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}><Upload size={15} /> 文件</button>
      <button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><FileText size={15} /> 粘贴文本</button>
    </div>
    <div className="form-grid form-spaced">
      <div className="field"><label htmlFor="resume-campaign">人才画像</label><select id="resume-campaign" name="campaignId" required>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></div>
      <div className="field"><label htmlFor="resume-source">来源类型</label><select id="resume-source" name="sourceType"><option value="CANDIDATE_SHARED">候选人主动提供</option><option value="BOSS_AUTHORIZED_DOWNLOAD">BOSS 官方授权下载</option><option value="AUTHORIZED_TEXT">已获授权的文本</option><option value="INTERNAL_AUTHORIZED">内部合规资料</option></select></div>
      {mode === "file" ? <div className="field full"><label htmlFor="resume-file">简历文件</label><input id="resume-file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required /><small>支持 PDF、DOCX、TXT、Markdown，单个文件不超过 10MB。</small></div> : <>
        <div className="field"><label htmlFor="resume-filename">档案名称</label><input id="resume-filename" name="fileName" defaultValue="粘贴简历.txt" /></div>
        <div className="field full"><label htmlFor="resume-text">简历正文</label><textarea id="resume-text" name="rawText" required placeholder={"姓名：张三\n职位：海外增长负责人\n2022-至今 | 某科技公司 | 海外业务负责人 | 负责 Google、Meta 与商业化"} /></div>
      </>}
      <div className="field full"><label htmlFor="resume-basis">处理依据</label><input id="resume-basis" name="legalBasis" required defaultValue="候选人主动提供并授权用于当前招聘" /><small>必须能说明简历为何可被当前团队处理并永久保留。</small></div>
    </div>
    <label className="check-row"><input type="checkbox" checked={runNow} onChange={(event) => setRunNow(event.target.checked)} /><span>导入后立即运行增量学习</span></label>
    <div className="form-actions"><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : runNow ? <Play size={16} /> : <Upload size={16} />}{loading ? "处理中" : runNow ? "导入并学习" : "仅导入"}</button>{message ? <span className="inline-message">{message}</span> : null}</div>
  </form>;
}
