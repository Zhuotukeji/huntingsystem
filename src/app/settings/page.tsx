import { Bot, BriefcaseBusiness, Database, Globe2, KeyRound, ShieldCheck } from "lucide-react";
import { PageIntro, StatusBadge } from "@/components/ui";

const sources = [
  { icon: BriefcaseBusiness, name: "BOSS 直聘", status: "waiting-human", label: "人工使用", detail: "当前仅有企业账号。V1 由 HR 在平台内搜索和沟通，再导入允许使用的线索，不执行自动登录或抓取。" },
  { icon: Database, name: "InsightTracker", status: "waiting-human", label: "人工使用", detail: "已确认不支持 API。AI 生成调研指令，HR 查询后导入平台允许留存的文件、链接或摘录。" },
  { icon: Globe2, name: "合规网页搜索 API", status: "draft", label: "未配置", detail: "接入后可让公司发现智能体无人值守运行。当前能力缺口不会被非合规抓取替代。" },
  { icon: Bot, name: "AI 模型", status: process.env.OPENAI_API_KEY ? "active" : "draft", label: process.env.OPENAI_API_KEY ? "已配置" : "演示模式", detail: process.env.OPENAI_API_KEY ? `使用 ${process.env.OPENAI_MODEL || "已配置模型"}，结构化输出仍需服务端证据校验。` : "未检测到 OPENAI_API_KEY，系统使用确定性演示智能体，不会发送数据到外部模型。" },
];

export default function SettingsPage() {
  return <>
    <PageIntro eyebrow="Sources & Governance" title="数据源与设置" description="统一管理数据获取边界、模型运行模式和可追溯性。V1 只启用已经确认合规的来源路径。" />
    <section className="section"><div className="section-head"><div><h3>数据连接</h3><p>连接状态不会扩大平台授权范围</p></div></div><div className="settings-list">{sources.map((source) => { const Icon = source.icon; return <div className="setting-row" key={source.name}><div className="setting-icon"><Icon size={20} /></div><div className="setting-main"><strong>{source.name}</strong><p>{source.detail}</p></div><StatusBadge status={source.status} label={source.label} /></div>; })}</div></section>
    <section className="section"><div className="section-head"><div><h3>治理策略</h3><p>试点阶段默认启用</p></div></div><div className="settings-list"><div className="setting-row"><div className="setting-icon"><ShieldCheck size={20} /></div><div className="setting-main"><strong>证据优先与人工决策</strong><p>事实必须关联来源；推测与未知项分开展示；AI 不自动淘汰、录用或联系候选人。</p></div><StatusBadge status="active" label="已启用" /></div><div className="setting-row"><div className="setting-icon"><KeyRound size={20} /></div><div className="setting-main"><strong>敏感数据最小化</strong><p>不采集婚育、年龄、家庭住址等无关字段；请勿联系状态优先级高于战役动作。</p></div><StatusBadge status="active" label="已启用" /></div></div></section>
    <div className="compliance-note"><ShieldCheck size={18} /><div><strong>重要边界</strong><br />系统不会绕过登录、验证码、付费墙或平台反自动化机制。新增自动数据源前应完成条款、个人信息和数据保留策略评审。</div></div>
  </>;
}
