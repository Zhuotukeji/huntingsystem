import { FileCheck2, FileClock, FileText, ShieldCheck } from "lucide-react";
import { ResumeWorkbench } from "@/components/resume-workbench";
import { EmptyState, Metric, PageIntro, StatusBadge } from "@/components/ui";
import { listCampaigns } from "@/lib/repository";
import { listResumes } from "@/lib/resumes";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = { PENDING: "待学习", PROCESSING: "分析中", READY: "已入图谱", NEEDS_REVIEW: "需复核", FAILED: "失败" };

export default function ResumesPage() {
  const campaigns = listCampaigns();
  const resumes = listResumes();
  const ready = resumes.filter((item) => item.status === "READY").length;
  const pending = resumes.filter((item) => item.status !== "READY").length;
  return <>
    <PageIntro eyebrow="Resume Source of Truth" title="简历库" description="所有公司和人才关系从已授权简历或合规人工资料中产生。导入时保留来源、处理依据、内容哈希和分析版本。" />
    <div className="metrics-grid">
      <Metric icon={FileText} label="简历总数" value={resumes.length} detail="按画像与内容哈希去重" />
      <Metric icon={FileCheck2} label="已入图谱" value={ready} detail="已生成任职与技能关系" tone="blue" />
      <Metric icon={FileClock} label="待处理" value={pending} detail="午夜任务优先处理新增和变化" tone="amber" />
      <Metric icon={ShieldCheck} label="默认保留期" value="180天" detail="到期数据进入治理清理范围" tone="purple" />
    </div>
    <section className="section"><div className="section-head"><div><h3>导入简历</h3><p>只有获得授权或具备明确处理依据的简历可以进入系统</p></div></div><ResumeWorkbench campaigns={campaigns} /></section>
    <section className="section"><div className="section-head"><div><h3>档案记录</h3><p>最近导入优先显示</p></div></div><div className="panel">
      {resumes.map((resume) => <div className="data-row" key={resume.id}><div className="row-icon"><FileText size={18} /></div><div className="row-main"><strong>{resume.personName || resume.fileName}</strong><span>{resume.campaignName} · {resume.sourceType} · {resume.legalBasis}</span>{resume.errorMessage ? <em className="row-error">{resume.errorMessage}</em> : null}</div><div className="row-meta">{new Date(resume.updatedAt).toLocaleString("zh-CN")}</div><StatusBadge status={resume.status} label={labels[resume.status] || resume.status} /></div>)}
      {!resumes.length ? <EmptyState icon={FileText} title="简历库为空" description="导入第一批授权简历后，AI 才会开始建立真实的公司与人才图谱。" /> : null}
    </div></section>
  </>;
}
