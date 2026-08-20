import { Bot, BriefcaseBusiness, Database, ShieldCheck } from "lucide-react";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { PageIntro, StatusBadge } from "@/components/ui";
import { getPublicAiSettings, hasPluginAccessCode } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const ai = getPublicAiSettings();
  const sources = [
    { icon: BriefcaseBusiness, name: "BOSS 直聘", status: "waiting-human", label: "人工操作", detail: "Chrome 插件提供搜索词、显式截图判断和结果回填。系统不持有 BOSS 账号、Cookie，不自动浏览或发送消息。" },
    { icon: Database, name: "InsightTracker", status: "waiting-human", label: "人工导入", detail: "当前无 API。HR 在授权账号内查询后，仅导入允许留存的文件、链接或原文摘录。" },
    { icon: Bot, name: "Sub2API", status: ai.enabled ? "active" : "draft", label: ai.enabled ? "已启用" : "未启用", detail: ai.enabled ? `当前模型 ${ai.model}，接口格式 ${ai.apiStyle}。` : "配置 Base URL、gpt-5.6 与 API Key 后启用真实 AI 分析。" },
  ];
  return <>
    <PageIntro eyebrow="Sources & Governance" title="数据源与设置" description="配置模型、插件访问和数据边界。密钥只在服务端解密使用，不会返回到浏览器。" />
    <section className="section"><div className="section-head"><div><h3>Sub2API 与插件配置</h3><p>保存后无需重启服务，下一次学习任务立即使用新配置</p></div></div><AiSettingsForm initial={{ ...ai, hasPluginAccessCode: hasPluginAccessCode() }} /></section>
    <section className="section"><div className="section-head"><div><h3>数据连接</h3><p>连接状态不会扩大外部平台的授权范围</p></div></div><div className="settings-list">{sources.map((source) => { const Icon = source.icon; return <div className="setting-row" key={source.name}><div className="setting-icon"><Icon size={20} /></div><div className="setting-main"><strong>{source.name}</strong><p>{source.detail}</p></div><StatusBadge status={source.status} label={source.label} /></div>; })}</div></section>
    <div className="compliance-note"><ShieldCheck size={18} /><div><strong>运行边界</strong><br />系统不会绕过登录、验证码、付费墙或平台反自动化机制；截图只在 HR 主动点击时处理且不持久化；AI 不自动淘汰、录用或联系候选人。</div></div>
  </>;
}
