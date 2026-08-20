import { FileCheck2, FileClock, FileText, ShieldCheck } from "lucide-react";
import { ResumeLibrary } from "@/components/resume-library";
import { Metric, PageIntro } from "@/components/ui";
import { listCampaigns } from "@/lib/repository";
import { listResumeProfiles } from "@/lib/resumes";

export const dynamic = "force-dynamic";

export default function ResumesPage() {
  const campaigns = listCampaigns();
  const resumes = listResumeProfiles();
  const ready = resumes.filter((item) => item.status === "READY").length;
  const pending = resumes.filter((item) => item.status !== "READY").length;
  return <>
    <PageIntro eyebrow="Resume Source of Truth" title="简历库" description="所有公司和人才关系从已授权简历中产生。导入时保留来源、处理依据、内容哈希和分析版本。" />
    <div className="metrics-grid">
      <Metric icon={FileText} label="简历总数" value={resumes.length} detail="按画像与内容哈希去重" />
      <Metric icon={FileCheck2} label="已入图谱" value={ready} detail="已生成任职与技能关系" tone="blue" />
      <Metric icon={FileClock} label="待处理" value={pending} detail="午夜任务优先处理新增和变化" tone="amber" />
      <Metric icon={ShieldCheck} label="保留规则" value="永久" detail="长期沉淀人才与公司知识" tone="purple" />
    </div>
    <section className="section"><div className="section-head"><div><h3>候选人档案</h3><p>默认按最近更新显示；展开可查看任职、技能、来源和学习状态</p></div></div><ResumeLibrary resumes={resumes} campaigns={campaigns} /></section>
  </>;
}
