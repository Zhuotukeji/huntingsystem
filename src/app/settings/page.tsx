import { Bot, BriefcaseBusiness, Database, ShieldCheck } from "lucide-react";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { CandidateAutomationForm } from "@/components/candidate-automation-form";
import { ExtensionInstaller } from "@/components/extension-installer";
import { PageIntro, StatusBadge } from "@/components/ui";
import { getCandidateAutomationSettings, getPublicAiSettings, hasPluginAccessCode } from "@/lib/settings";
import { getAutonomySettings } from "@/lib/settings";
import { AutonomySettingsForm } from "@/components/autonomy-settings-form";
import { getExtensionDeliveryStatus } from "@/lib/extension-delivery";
import { hasPermission, requirePagePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePagePermission("settings.view");
  const canManage = hasPermission(user, "settings.manage");
  const ai = getPublicAiSettings();
  const candidateAutomation = getCandidateAutomationSettings();
  const autonomy = getAutonomySettings();
  const extension = getExtensionDeliveryStatus();
  const sources = [
    { icon: BriefcaseBusiness, name: "BOSS 直聘", status: "waiting-human", label: "人工操作", detail: "Chrome 插件提供搜索词、显式截图判断、简历关键帧扫描和结果回填。系统不持有 BOSS 账号、Cookie，不自动浏览或发送消息。" },
    { icon: Database, name: "授权简历库", status: "active", label: "核心事实源", detail: "AI 只从已记录来源和处理依据的候选人简历中学习公司、任职、技能和搜索线索。" },
    { icon: Bot, name: "Sub2API", status: ai.enabled ? "active" : "draft", label: ai.enabled ? "已启用" : "未启用", detail: ai.enabled ? `当前模型 ${ai.model}，接口格式 ${ai.apiStyle}。` : "配置 Base URL、gpt-5.6 与 API Key 后启用真实 AI 分析。" },
  ];
  return <>
    <PageIntro eyebrow="Sources & Governance" title="数据源与设置" description="配置模型、插件访问和数据边界。密钥只在服务端解密使用，不会返回到浏览器。" />
    {canManage ? <section className="section"><div className="section-head"><div><h3>学习质量与自动化规则</h3><p>控制简历准入、公司事实晋升、候选人自动推进和 BOSS 搜索任务门槛</p></div></div><CandidateAutomationForm initial={candidateAutomation} /></section> : null}
    {canManage ? <section className="section"><div className="section-head"><div><h3>AI 自主复盘与联网情报</h3><p>控制研究预算、证据时效、复盘样本量和策略调整边界</p></div></div><AutonomySettingsForm initial={autonomy} /></section> : null}
    {canManage ? <section className="section"><div className="section-head"><div><h3>Sub2API 与插件配置</h3><p>保存后无需重启服务，下一次学习任务立即使用新配置</p></div></div><AiSettingsForm initial={{ ...ai, hasPluginAccessCode: hasPluginAccessCode() }} /></section> : null}
    {canManage ? <section className="section"><div className="section-head"><div><h3>Chrome 插件</h3><p>官方商店安装、版本检测与开发分发</p></div></div><ExtensionInstaller initial={extension} /></section> : null}
    <section className="section"><div className="section-head"><div><h3>数据连接</h3><p>连接状态不会扩大外部平台的授权范围</p></div></div><div className="settings-list">{sources.map((source) => { const Icon = source.icon; return <div className="setting-row" key={source.name}><div className="setting-icon"><Icon size={20} /></div><div className="setting-main"><strong>{source.name}</strong><p>{source.detail}</p></div><StatusBadge status={source.status} label={source.label} /></div>; })}</div></section>
    <div className="compliance-note"><ShieldCheck size={18} /><div><strong>运行边界</strong><br />系统不会绕过登录、验证码、付费墙或平台反自动化机制；扫描只在 HR 主动开始后处理且不持久化画面；AI 仅按管理员配置的评分规则自动推进或结束本战役，不会自动联系、面试、发 Offer 或录用候选人。</div></div>
  </>;
}
