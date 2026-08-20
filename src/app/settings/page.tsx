import { Bot, BriefcaseBusiness, Chrome, Database, Download, PackageCheck, ShieldCheck } from "lucide-react";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { PageIntro, StatusBadge } from "@/components/ui";
import { getPublicAiSettings, hasPluginAccessCode } from "@/lib/settings";
import { getExtensionDeliveryStatus } from "@/lib/extension-delivery";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const ai = getPublicAiSettings();
  const extension = getExtensionDeliveryStatus();
  const sources = [
    { icon: BriefcaseBusiness, name: "BOSS 直聘", status: "waiting-human", label: "人工操作", detail: "Chrome 插件提供搜索词、显式截图判断、多屏简历采集和结果回填。系统不持有 BOSS 账号、Cookie，不自动浏览或发送消息。" },
    { icon: Database, name: "授权简历库", status: "active", label: "核心事实源", detail: "AI 只从已记录来源和处理依据的候选人简历中学习公司、任职、技能和搜索线索。" },
    { icon: Bot, name: "Sub2API", status: ai.enabled ? "active" : "draft", label: ai.enabled ? "已启用" : "未启用", detail: ai.enabled ? `当前模型 ${ai.model}，接口格式 ${ai.apiStyle}。` : "配置 Base URL、gpt-5.6 与 API Key 后启用真实 AI 分析。" },
  ];
  return <>
    <PageIntro eyebrow="Sources & Governance" title="数据源与设置" description="配置模型、插件访问和数据边界。密钥只在服务端解密使用，不会返回到浏览器。" />
    <section className="section"><div className="section-head"><div><h3>Sub2API 与插件配置</h3><p>保存后无需重启服务，下一次学习任务立即使用新配置</p></div></div><AiSettingsForm initial={{ ...ai, hasPluginAccessCode: hasPluginAccessCode() }} /></section>
    <section className="section"><div className="section-head"><div><h3>Chrome 插件</h3><p>本机侧载版本与后端连接说明</p></div>{extension.downloadable ? <a className="button primary" href="/api/extension/download"><Download size={16} />下载 ZIP</a> : null}</div>
      <div className="extension-delivery">
        <div className="extension-summary"><div className="setting-icon"><Chrome size={21} /></div><div><strong>觅才 BOSS 寻访助手 v{extension.version}</strong><p>{extension.downloadable ? "分发包已生成，可下载或直接加载仓库 extension 目录。" : "源码已就绪，运行 pnpm extension:pack 后可在此下载分发包。"}</p></div><StatusBadge status={extension.downloadable ? "active" : "draft"} label={extension.downloadable ? "可安装" : "待打包"} /></div>
        <ol className="install-steps"><li><span>1</span><p>解压 ZIP；或开发调试时直接使用仓库中的 <code>extension/</code> 目录。</p></li><li><span>2</span><p>打开 <code>chrome://extensions</code>，启用开发者模式，选择“加载已解压的扩展程序”。</p></li><li><span>3</span><p>启动后台后点击插件。它会依次检测 <code>localhost:3010</code> 和 <code>localhost:3000</code>，也可手动修改。</p></li></ol>
        {extension.checksum ? <div className="checksum"><PackageCheck size={15} /><span>SHA-256</span><code>{extension.checksum}</code></div> : null}
      </div>
    </section>
    <section className="section"><div className="section-head"><div><h3>数据连接</h3><p>连接状态不会扩大外部平台的授权范围</p></div></div><div className="settings-list">{sources.map((source) => { const Icon = source.icon; return <div className="setting-row" key={source.name}><div className="setting-icon"><Icon size={20} /></div><div className="setting-main"><strong>{source.name}</strong><p>{source.detail}</p></div><StatusBadge status={source.status} label={source.label} /></div>; })}</div></section>
    <div className="compliance-note"><ShieldCheck size={18} /><div><strong>运行边界</strong><br />系统不会绕过登录、验证码、付费墙或平台反自动化机制；截图只在 HR 主动点击时处理且不持久化；AI 不自动淘汰、录用或联系候选人。</div></div>
  </>;
}
