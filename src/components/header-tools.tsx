"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bell, BrainCircuit, BriefcaseBusiness, Building2, ClipboardList, FileText, RefreshCw, Search, Users, X } from "lucide-react";
import type { HeaderNotification, HeaderSearchKind, HeaderSearchResult } from "@/lib/header-data";
import type { PermissionCode } from "@/lib/access-control";

const quickLinks = [
  { href: "/campaigns", label: "寻访战役", description: "查看当前画像和目标", icon: BriefcaseBusiness, permission: "campaigns.view" as PermissionCode },
  { href: "/resumes", label: "简历库", description: "查找永久保留的候选人档案", icon: FileText, permission: "resumes.view" as PermissionCode },
  { href: "/organizations", label: "公司发现", description: "查看简历证据支持的公司", icon: Building2, permission: "organizations.view" as PermissionCode },
  { href: "/people", label: "人员发现", description: "审核候选人与画像匹配", icon: Users, permission: "people.view" as PermissionCode },
  { href: "/search-tasks", label: "BOSS 搜索任务", description: "执行下一轮人工搜索", icon: ClipboardList, permission: "search_tasks.view" as PermissionCode },
];

const resultIcons: Record<HeaderSearchKind, typeof Search> = {
  campaign: BriefcaseBusiness,
  resume: FileText,
  organization: Building2,
  person: Users,
  "search-task": ClipboardList,
};

const notificationIcons: Record<HeaderNotification["kind"], typeof Search> = {
  organization: Building2,
  person: Users,
  resume: FileText,
  "search-task": ClipboardList,
  learning: BrainCircuit,
};

type SearchStatus = "idle" | "loading" | "ready" | "error";
type NotificationState = { count: number; items: HeaderNotification[]; loading: boolean; error: string };

export function HeaderTools({ permissions }: { permissions: PermissionCode[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const notificationAnchor = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HeaderSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [selectedResult, setSelectedResult] = useState(0);
  const [notifications, setNotifications] = useState<NotificationState>({ count: 0, items: [], loading: true, error: "" });

  const loadNotifications = useCallback(async () => {
    setNotifications((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/header", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "通知加载失败");
      setNotifications({ count: payload.data.count, items: payload.data.items, loading: false, error: "" });
    } catch (error) {
      setNotifications((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "通知加载失败" }));
    }
  }, []);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setNotificationOpen(false);
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!notificationAnchor.current?.contains(event.target as Node)) setNotificationOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [notificationOpen]);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    setSearchOpen(false);
    setNotificationOpen(false);
    setQuery("");
  }, [pathname]);

  useEffect(() => {
    if (!searchOpen) return;
    window.requestAnimationFrame(() => searchInput.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const normalized = query.trim();
    if (!normalized) {
      setResults([]);
      setSearchStatus("idle");
      setSelectedResult(0);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchStatus("loading");
      try {
        const response = await fetch(`/api/header?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "搜索失败");
        setResults(payload.data.results);
        setSelectedResult(0);
        setSearchStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setResults([]);
        setSearchStatus("error");
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, searchOpen]);

  function openSearch() {
    setNotificationOpen(false);
    setSearchOpen(true);
  }

  function navigate(href: string) {
    setSearchOpen(false);
    setNotificationOpen(false);
    setQuery("");
    router.push(href);
  }

  function handleSearchKeys(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setSelectedResult((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setSelectedResult((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && results[selectedResult]) {
      event.preventDefault();
      navigate(results[selectedResult].href);
    }
  }

  function toggleNotifications() {
    const next = !notificationOpen;
    setSearchOpen(false);
    setNotificationOpen(next);
    if (next) void loadNotifications();
  }

  return <>
    <div className="topbar-actions">
      <button className="global-search" type="button" title="全局搜索" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={openSearch}>
        <Search size={17} /><span>搜索公司、人选或任务</span><kbd>Ctrl K</kbd>
      </button>
      <div className="notification-anchor" ref={notificationAnchor}>
        <button className="icon-button" type="button" aria-label="通知" title="通知" aria-haspopup="dialog" aria-expanded={notificationOpen} aria-controls="notification-panel" onClick={toggleNotifications}>
          <Bell size={19} />
          {notifications.count ? <span className="notification-count">{notifications.count > 99 ? "99+" : notifications.count}</span> : null}
        </button>
        {notificationOpen ? <section className="notification-popover" id="notification-panel" role="dialog" aria-label="待处理通知">
          <div className="popover-head"><div><strong>待处理</strong><span>{notifications.count ? `共 ${notifications.count} 项` : "当前没有积压"}</span></div><button className="icon-button compact" type="button" onClick={() => void loadNotifications()} aria-label="刷新通知" title="刷新通知" disabled={notifications.loading}><RefreshCw size={15} className={notifications.loading ? "spin" : ""} /></button></div>
          <div className="notification-list" aria-live="polite">
            {notifications.loading && !notifications.items.length ? <div className="popover-state"><RefreshCw className="spin" size={18} /><span>正在同步待办</span></div> : null}
            {notifications.error ? <div className="popover-state error"><span>{notifications.error}</span><button type="button" className="plain-action" onClick={() => void loadNotifications()}>重试</button></div> : null}
            {!notifications.loading && !notifications.error && !notifications.items.length ? <div className="popover-state"><Bell size={20} /><strong>没有待处理事项</strong><span>新的审核或搜索任务会显示在这里。</span></div> : null}
            {notifications.items.map((item) => {
              const Icon = notificationIcons[item.kind];
              return <Link href={item.href} className="notification-item" key={item.id} onClick={() => setNotificationOpen(false)}><span className={`notification-icon tone-${item.kind}`}><Icon size={16} /></span><span className="notification-main"><strong>{item.count} {item.title}</strong><small>{item.description}</small></span><ArrowRight size={14} /></Link>;
            })}
          </div>
        </section> : null}
      </div>
    </div>

    {searchOpen && typeof document !== "undefined" ? createPortal(<div className="modal-backdrop command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
        <h2 id="global-search-title" className="sr-only">全局搜索</h2>
        <div className="command-input"><Search size={19} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeys} aria-label="全局搜索" placeholder="输入公司、人选、简历或任务关键词" autoComplete="off" /><button className="icon-button compact" type="button" aria-label="关闭搜索" title="关闭" onClick={() => setSearchOpen(false)}><X size={17} /></button></div>
        <div className="command-results" role="listbox" aria-label="搜索结果" aria-live="polite">
          {!query.trim() ? <><p className="command-label">快速进入</p>{quickLinks.filter((item) => permissions.includes(item.permission)).map((item) => { const Icon = item.icon; return <button type="button" className="command-result" key={item.href} onClick={() => navigate(item.href)}><span className="command-icon"><Icon size={17} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowRight size={15} /></button>; })}</> : null}
          {query.trim() && searchStatus === "loading" ? <div className="command-state"><RefreshCw className="spin" size={20} /><span>正在检索</span></div> : null}
          {query.trim() && searchStatus === "error" ? <div className="command-state error"><strong>搜索暂时不可用</strong><span>请稍后重试。</span></div> : null}
          {query.trim() && searchStatus === "ready" && !results.length ? <div className="command-state"><Search size={22} /><strong>没有匹配结果</strong><span>尝试公司简称、人名或职位关键词。</span></div> : null}
          {query.trim() && results.map((item, index) => {
            const Icon = resultIcons[item.kind];
            return <button type="button" role="option" aria-selected={index === selectedResult} className={`command-result ${index === selectedResult ? "selected" : ""}`} key={`${item.kind}-${item.id}`} onMouseEnter={() => setSelectedResult(index)} onClick={() => navigate(item.href)}><span className="command-icon"><Icon size={17} /></span><span><em>{item.label}</em><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={15} /></button>;
          })}
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}
