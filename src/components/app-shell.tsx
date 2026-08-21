"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BrainCircuit, BriefcaseBusiness, Building2, ChevronDown, ClipboardList, FileText, KeyRound, LayoutDashboard, LogOut, Menu, Network, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
import { HeaderTools } from "@/components/header-tools";
import type { CurrentUser } from "@/lib/auth";
import type { PermissionCode } from "@/lib/access-control";

const navigation: { href: string; label: string; icon: typeof LayoutDashboard; permission: PermissionCode }[] = [
  { href: "/", label: "工作台", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/campaigns", label: "寻访战役", icon: BriefcaseBusiness, permission: "campaigns.view" },
  { href: "/resumes", label: "简历库", icon: FileText, permission: "resumes.view" },
  { href: "/graph", label: "人才图谱", icon: Network, permission: "graph.view" },
  { href: "/search-tasks", label: "BOSS 搜索任务", icon: ClipboardList, permission: "search_tasks.view" },
  { href: "/learning", label: "AI 学习中心", icon: BrainCircuit, permission: "learning.view" },
  { href: "/organizations", label: "公司发现", icon: Building2, permission: "organizations.view" },
  { href: "/people", label: "候选人推进", icon: Users, permission: "people.view" },
];

const titles: Record<string, string> = {
  "/": "今日工作台", "/campaigns": "寻访战役", "/resumes": "简历库", "/graph": "公司与人才图谱", "/search-tasks": "BOSS 搜索任务", "/learning": "AI 学习中心", "/organizations": "公司发现", "/people": "候选人推进", "/settings": "数据源与设置", "/access": "人员与权限", "/account": "账号安全", "/forbidden": "访问受限",
};

export function AppShell({ children, user }: { children: React.ReactNode; user: CurrentUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const titleKey = Object.keys(titles).sort((a, b) => b.length - a.length).find((key) => key === "/" ? pathname === "/" : pathname.startsWith(key));
  const can = (permission: PermissionCode) => Boolean(user?.permissions.includes(permission));

  if (pathname === "/login") return <>{children}</>;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Search size={17} strokeWidth={2.4} /></div>
          <div><strong>觅才</strong><span>AI Talent Intelligence</span></div>
        </div>
        <button className="mobile-close icon-button" onClick={() => setOpen(false)} aria-label="关闭菜单" title="关闭菜单"><X size={19} /></button>
        <nav className="sidebar-nav" aria-label="主导航">
          <p className="nav-group-label">工作空间</p>
          {navigation.filter((item) => can(item.permission)).map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
          <p className="nav-group-label nav-group-spaced">系统</p>
          {can("settings.view") ? <Link href="/settings" className={`nav-item ${pathname.startsWith("/settings") ? "active" : ""}`} onClick={() => setOpen(false)}><Settings size={18} /><span>数据源与设置</span></Link> : null}
          {can("access.view") ? <Link href="/access" className={`nav-item ${pathname.startsWith("/access") ? "active" : ""}`} onClick={() => setOpen(false)}><ShieldCheck size={18} /><span>人员与权限</span></Link> : null}
          <a href="/docs" className="nav-item" onClick={(event) => event.preventDefault()}><ClipboardList size={18} /><span>操作审计</span><span className="soon">即将上线</span></a>
        </nav>
        <div className="sidebar-user-wrap">
          {userMenuOpen ? <div className="sidebar-user-menu">
            <Link href="/account" onClick={() => { setUserMenuOpen(false); setOpen(false); }}><KeyRound size={15} />账号安全</Link>
            <button type="button" onClick={logout}><LogOut size={15} />退出登录</button>
          </div> : null}
          <button type="button" className="sidebar-foot" onClick={() => setUserMenuOpen((value) => !value)} aria-expanded={userMenuOpen}>
            <div className="avatar">{user?.name.slice(0, 1) || "?"}</div>
            <div><strong>{user?.name || "未登录"}</strong><span>{user?.roles.map((role) => role.name).join("、") || "暂无角色"}</span></div>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      {open ? <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="关闭菜单遮罩" /> : null}
      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setOpen(true)} aria-label="打开菜单" title="打开菜单"><Menu size={20} /></button>
          <div><h1>{titles[titleKey || "/"]}</h1><span className="topbar-context">{user?.name || "觅才工作台"}</span></div>
          {user ? <HeaderTools permissions={user.permissions} /> : null}
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
