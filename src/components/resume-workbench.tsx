"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, FileCheck2, FileText, LoaderCircle, Play, Upload, XCircle } from "lucide-react";
import type { AiRun, Campaign } from "@/lib/types";

type ImportStage = "idle" | "validating" | "uploading" | "queued" | "analyzing" | "generating" | "refreshing" | "success" | "error";

const stageDetails: Record<ImportStage, { title: string; detail: string; percent: number }> = {
  idle: { title: "等待导入", detail: "", percent: 0 },
  validating: { title: "正在检查简历", detail: "确认文件格式、大小和处理依据。", percent: 8 },
  uploading: { title: "正在解析并入库", detail: "提取文件文本并保存永久简历档案。", percent: 30 },
  queued: { title: "学习任务已创建", detail: "正在等待 AI 开始分析这份简历。", percent: 50 },
  analyzing: { title: "AI 正在分析简历", detail: "正在提取候选人、任职公司、职位、技能和画像证据。", percent: 72 },
  generating: { title: "正在生成搜索任务", detail: "根据更新后的公司和人才关系生成下一轮 BOSS 搜索线索。", percent: 88 },
  refreshing: { title: "正在更新页面数据", detail: "学习已完成，正在刷新简历库和图谱。", percent: 96 },
  success: { title: "导入处理完成", detail: "简历库和相关数据已更新。", percent: 100 },
  error: { title: "处理未完成", detail: "请根据错误信息修改后重试。", percent: 100 },
};

const stepOrder: Record<ImportStage, number> = { idle: -1, validating: 0, uploading: 0, queued: 1, analyzing: 1, generating: 2, refreshing: 2, success: 3, error: -1 };
const progressSteps = ["解析并入库", "AI 学习简历", "更新图谱与任务"];
const terminalStatuses = new Set<AiRun["status"]>(["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"]);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload.data as T;
}

export function ResumeWorkbench({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [stage, setStage] = useState<ImportStage>("idle");
  const [message, setMessage] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const busy = !["idle", "success", "error"].includes(stage);
  const progress = stageDetails[stage];

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function updateRunStage(run: AiRun) {
    if (run.stage === "ANALYZE_RESUMES") setStage("analyzing");
    else if (run.stage === "GENERATE_SEARCH_TASKS") setStage("generating");
    else if (run.status === "QUEUED") setStage("queued");
  }

  async function executeAndTrackRun(runId: string) {
    let executionFinished = false;
    let executionError: Error | null = null;
    void fetch(`/api/ai-runs/${runId}`, { method: "POST" })
      .then((response) => responseData<AiRun>(response))
      .catch((error) => { executionError = error instanceof Error ? error : new Error("AI 学习失败"); })
      .finally(() => { executionFinished = true; });

    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const run = await responseData<AiRun>(await fetch(`/api/ai-runs/${runId}`, { cache: "no-store" }));
      updateRunStage(run);
      if (terminalStatuses.has(run.status)) return run;
      if (executionFinished && executionError) throw executionError;
      await wait(900);
    }
    throw new Error("AI 学习超过 10 分钟仍未完成，可前往 AI 学习中心查看任务状态");
  }

  async function submit(formData: FormData) {
    setElapsed(0);
    setMessage("");
    setStage("validating");
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      if (mode === "file") {
        const file = formData.get("file");
        if (!(file instanceof File) || !file.size) throw new Error("请选择有效的简历文件");
        if (file.size > 10 * 1024 * 1024) throw new Error("简历文件不能超过 10MB");
      }

      setStage("uploading");
      const importResponse = mode === "file"
        ? await fetch("/api/resumes", { method: "POST", body: formData })
        : await fetch("/api/resumes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: formData.get("campaignId"),
            fileName: formData.get("fileName") || "粘贴简历.txt",
            rawText: formData.get("rawText"),
            sourceType: formData.get("sourceType"),
            legalBasis: formData.get("legalBasis"),
            createdBy: "当前用户",
          }),
        });
      const imported = await responseData<{ duplicate: boolean; resume: { id: string } }>(importResponse);

      if (runNow && !imported.duplicate) {
        setStage("queued");
        const queuedRun = await responseData<AiRun>(await fetch("/api/ai-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: formData.get("campaignId"), resumeIds: [imported.resume.id], queueOnly: true }),
        }));
        const completed = await executeAndTrackRun(queuedRun.id);
        if (completed.status === "FAILED" || completed.status === "CANCELLED") throw new Error(completed.errorMessage || completed.summary || "简历已导入，但 AI 学习失败");
        setStage("refreshing");
        router.refresh();
        await wait(250);
        setMessage(completed.summary);
      } else {
        setStage("refreshing");
        router.refresh();
        await wait(250);
        setMessage(imported.duplicate ? "相同简历已存在，本次未重复写入。" : "简历已进入待学习队列。");
      }
      setStage("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
      setStage("error");
    }
  }

  return <form className="resume-import-form" action={submit}>
    <fieldset className="resume-inputs" disabled={busy}>
      <div className="segmented wide-segment" aria-label="导入方式">
        <button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}><Upload size={15} /> 文件</button>
        <button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><FileText size={15} /> 粘贴文本</button>
      </div>
      <div className="form-grid form-spaced">
        <div className="field"><label htmlFor="resume-campaign">人才画像</label><select id="resume-campaign" name="campaignId" required>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></div>
        <div className="field"><label htmlFor="resume-source">来源类型</label><select id="resume-source" name="sourceType"><option value="CANDIDATE_SHARED">候选人主动提供</option><option value="BOSS_AUTHORIZED_DOWNLOAD">BOSS 官方授权下载</option><option value="AUTHORIZED_TEXT">已获授权的文本</option><option value="INTERNAL_AUTHORIZED">内部合规资料</option></select></div>
        {mode === "file" ? <div className="field full"><label htmlFor="resume-file">简历文件</label><input id="resume-file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required onChange={(event) => { const file = event.target.files?.[0]; setSelectedFile(file ? { name: file.name, size: file.size } : null); setStage("idle"); setMessage(""); }} />{selectedFile ? <div className="selected-file"><FileCheck2 size={16} /><span><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)} · 已选择</small></span></div> : <small>支持 PDF、DOCX、TXT、Markdown，单个文件不超过 10MB。</small>}</div> : <>
          <div className="field"><label htmlFor="resume-filename">档案名称</label><input id="resume-filename" name="fileName" defaultValue="粘贴简历.txt" /></div>
          <div className="field full"><label htmlFor="resume-text">简历正文</label><textarea id="resume-text" name="rawText" required placeholder="粘贴已获授权的候选人简历全文" /></div>
        </>}
        <div className="field full"><label htmlFor="resume-basis">处理依据</label><input id="resume-basis" name="legalBasis" required defaultValue="候选人主动提供并授权用于当前招聘" /><small>必须能说明简历为何可被当前团队处理并永久保留。</small></div>
      </div>
      <label className="check-row"><input type="checkbox" checked={runNow} onChange={(event) => setRunNow(event.target.checked)} /><span>导入后立即运行增量学习</span></label>
    </fieldset>

    {stage !== "idle" ? <section className={`import-progress status-${stage}`} aria-live="polite">
      <div className="import-progress-head"><span className="import-progress-icon">{stage === "success" ? <CheckCircle2 size={18} /> : stage === "error" ? <XCircle size={18} /> : <LoaderCircle className="spin" size={18} />}</span><div><strong>{progress.title}</strong><p>{message || progress.detail}</p></div>{busy ? <time>{formatElapsed(elapsed)}</time> : null}</div>
      <div className="import-progress-track" role="progressbar" aria-label="简历导入进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
      <ol className="import-progress-steps">{progressSteps.map((label, index) => {
        const done = stage === "success" || stepOrder[stage] > index;
        const active = busy && stepOrder[stage] === index;
        return <li className={done ? "done" : active ? "active" : stage === "error" ? "failed" : ""} key={label}>{done ? <CheckCircle2 size={14} /> : active ? <LoaderCircle className="spin" size={14} /> : stage === "error" ? <XCircle size={14} /> : <Circle size={14} />}<span>{label}</span></li>;
      })}</ol>
    </section> : null}

    <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : stage === "success" ? <CheckCircle2 size={16} /> : stage === "error" ? <Play size={16} /> : runNow ? <Play size={16} /> : <Upload size={16} />}{busy ? progress.title : stage === "error" ? "重试导入" : stage === "success" ? "再次导入" : runNow ? "导入并学习" : "仅导入"}</button></div>
  </form>;
}
