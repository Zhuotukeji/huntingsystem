"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Chrome, Download, ExternalLink, LoaderCircle, PackageCheck, RefreshCw, Save, ShieldAlert } from "lucide-react";

type Delivery = {
  version: string;
  fileName: string;
  downloadable: boolean;
  checksum: string;
  webStoreUrl: string;
  extensionId: string;
  deliveryMode: "WEB_STORE" | "SIDELOAD";
};

type RuntimeApi = {
  lastError?: { message?: string };
  sendMessage: (extensionId: string, message: unknown, callback: (response?: { ok?: boolean; version?: string }) => void) => void;
};

type InstallState = "checking" | "installed" | "not-installed" | "unsupported" | "unconfigured";

function chromeRuntime() {
  return (window as Window & { chrome?: { runtime?: RuntimeApi } }).chrome?.runtime;
}

async function pingExtension(extensionId: string) {
  const runtime = chromeRuntime();
  if (!runtime || !extensionId) return null;
  return new Promise<string | null>((resolve) => {
    let finished = false;
    const finish = (version: string | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve(version);
    };
    const timer = window.setTimeout(() => finish(null), 1600);
    try {
      runtime.sendMessage(extensionId, { type: "HUNTING_EXTENSION_PING" }, (response) => {
        if (runtime.lastError || !response?.ok) return finish(null);
        finish(response.version || "unknown");
      });
    } catch {
      finish(null);
    }
  });
}

export function ExtensionInstaller({ initial }: { initial: Delivery }) {
  const [delivery, setDelivery] = useState(initial);
  const [webStoreUrl, setWebStoreUrl] = useState(initial.webStoreUrl);
  const [installState, setInstallState] = useState<InstallState>(initial.extensionId ? "checking" : "unconfigured");
  const [installedVersion, setInstalledVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function checkInstalled() {
    if (!delivery.extensionId) {
      setInstallState("unconfigured");
      return;
    }
    if (!/Chrome\//.test(navigator.userAgent) || /Edg\//.test(navigator.userAgent)) {
      setInstallState("unsupported");
      return;
    }
    setInstallState("checking");
    const version = await pingExtension(delivery.extensionId);
    setInstalledVersion(version || "");
    setInstallState(version ? "installed" : "not-installed");
  }

  useEffect(() => {
    let cancelled = false;
    if (!delivery.extensionId) return;
    void pingExtension(delivery.extensionId).then((version) => {
      if (cancelled) return;
      setInstalledVersion(version || "");
      setInstallState(!/Chrome\//.test(navigator.userAgent) || /Edg\//.test(navigator.userAgent) ? "unsupported" : version ? "installed" : "not-installed");
    });
    return () => { cancelled = true; };
  }, [delivery.extensionId]);

  async function saveDistribution() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings/extension", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webStoreUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      setDelivery((current) => ({ ...current, ...result.data, deliveryMode: result.data.webStoreUrl ? "WEB_STORE" : "SIDELOAD" }));
      setWebStoreUrl(result.data.webStoreUrl);
      setMessage(result.data.webStoreUrl ? "商店安装入口已启用。" : "已切换为开发侧载模式。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const installed = installState === "installed";
  const status = installed ? { className: "status-active", label: installedVersion === delivery.version ? "已安装" : "需更新" }
    : delivery.webStoreUrl ? { className: "status-pending-review", label: "可在线安装" }
      : { className: "status-waiting-human", label: "待发布商店" };

  return <div className="extension-delivery">
    <div className="extension-summary">
      <div className="setting-icon"><Chrome size={21} /></div>
      <div><strong>觅才 BOSS 寻访助手 v{delivery.version}</strong><p>{installed ? `当前 Chrome 已连接插件 v${installedVersion}。` : delivery.webStoreUrl ? "已配置 Chrome Web Store，可从后台进入官方安装。" : "当前只有开发侧载包，需配置 Chrome Web Store 后启用在线安装。"}</p></div>
      <span className={`status-badge ${status.className}`}><i />{status.label}</span>
    </div>

    <div className="extension-install-row">
      <div className="extension-install-state">
        {installState === "checking" ? <LoaderCircle className="spin" size={18} /> : installed ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
        <div><strong>{installState === "checking" ? "正在检测 Chrome" : installed ? "插件已经安装" : delivery.webStoreUrl ? "等待安装" : "在线安装尚未启用"}</strong><p>{installState === "unsupported" ? "请使用 Google Chrome 打开本页完成安装。" : installed && installedVersion !== delivery.version ? `浏览器版本为 v${installedVersion}，请从商店更新到 v${delivery.version}。` : delivery.webStoreUrl ? "Chrome 会在官方商店要求确认一次，这是浏览器强制安全步骤。" : "Chrome 禁止普通网页直接安装 ZIP 或未上架扩展。"}</p></div>
      </div>
      <div className="extension-install-actions">
        {delivery.webStoreUrl ? <a className="button primary" href={delivery.webStoreUrl} target="_blank" rel="noreferrer" onClick={() => setMessage("商店已打开，确认安装后返回本页检测。")}><ExternalLink size={16} />{installed ? "查看商店" : "安装到 Chrome"}</a> : null}
        {delivery.extensionId ? <button className="button" type="button" disabled={installState === "checking"} onClick={() => void checkInstalled()}><RefreshCw className={installState === "checking" ? "spin" : ""} size={16} />检测安装</button> : null}
        {!delivery.webStoreUrl && delivery.downloadable ? <a className="button" href="/api/extension/download"><Download size={16} />下载开发包</a> : null}
      </div>
    </div>

    {!delivery.webStoreUrl ? <ol className="install-steps compact-install-steps">
      <li><span>1</span><p>先将插件发布为 Chrome Web Store 的“未公开”应用，无需公开展示。</p></li>
      <li><span>2</span><p>复制商店详情页地址，在下方“商店发布配置”中保存。</p></li>
      <li><span>3</span><p>此后 HR 直接点击“安装到 Chrome”，不再下载、解压或打开开发者模式。</p></li>
    </ol> : null}

    <details className="extension-config">
      <summary>商店发布配置</summary>
      <div className="extension-config-body">
        <div className="field"><label htmlFor="chrome-web-store-url">Chrome Web Store 详情页地址</label><input id="chrome-web-store-url" value={webStoreUrl} onChange={(event) => setWebStoreUrl(event.target.value)} placeholder="https://chromewebstore.google.com/detail/.../扩展ID" /></div>
        <button className="button" type="button" disabled={saving} onClick={() => void saveDistribution()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存</button>
      </div>
    </details>
    {message ? <div className="extension-config-message" aria-live="polite">{message}</div> : null}

    {delivery.checksum ? <div className="checksum"><PackageCheck size={15} /><span>开发包 SHA-256</span><code>{delivery.checksum}</code></div> : null}
  </div>;
}
