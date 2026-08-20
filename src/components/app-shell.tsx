"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrainCircuit, BriefcaseBusiness, Building2, ChevronDown, ClipboardList, FileText, LayoutDashboard, Menu, Network, Search, Settings, Users, X } from "lucide-react";
import { HeaderTools } from "@/components/header-tools";

const navigation = [
  { href: "/", label: "工作台", icon: LayoutDashboard },
  { href: "/campaigns", label: "寻访战役", icon: BriefcaseBusiness },
  { href: "/resumes", label: "简历库", icon: FileText },
  { href: "/graph", label: "人才图谱", icon: Network },
  { href: "/search-tasks", label: "BOSS 搜索任务", icon: ClipboardList },
  { href: "/learning", label: "AI 学习中心", icon: BrainCircuit },
  { href: "/organizations", label: "公司发现", icon: Building2 },
  { href: "/people", label: "人员发现", icon: Users },
];

const titles: Record<string, string> = {
  "/": "今日工作台", "/campaigns": "寻访战役", "/resumes": "简历库", "/graph": "公司与人才图谱", "/search-tasks": "BOSS 搜索任务", "/learning": "AI 学习中心", "/organizations": "公司发现", "/people": "人员发现", "/settings": "数据源与设置",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const titleKey = Object.keys(titles).sort((a, b) => b.length - a.length).find((key) => key === "/" ? pathname === "/" : pathname.startsWith(key));

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
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
          <p className="nav-group-label nav-group-spaced">系统</p>
          <Link href="/settings" className={`nav-item ${pathname.startsWith("/settings") ? "active" : ""}`} onClick={() => setOpen(false)}><Settings size={18} /><span>数据源与设置</span></Link>
          <a href="/docs" className="nav-item" onClick={(event) => event.preventDefault()}><ClipboardList size={18} /><span>操作审计</span><span className="soon">即将上线</span></a>
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">陈</div>
          <div><strong>陈晨</strong><span>寻访负责人</span></div>
          <ChevronDown size={16} />
        </div>
      </aside>
      {open ? <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="关闭菜单遮罩" /> : null}
      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setOpen(true)} aria-label="打开菜单" title="打开菜单"><Menu size={20} /></button>
          <div><h1>{titles[titleKey || "/"]}</h1><span className="topbar-context">海外项目负责人寻访</span></div>
          <HeaderTools />
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
