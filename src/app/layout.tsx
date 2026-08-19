import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "觅才 · AI 人才寻访",
  description: "证据驱动的 AI 人才发现与审核工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><AppShell>{children}</AppShell></body></html>;
}
