import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireAuthenticatedPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  await requireAuthenticatedPage();
  return <div className="forbidden-state"><ShieldAlert size={34} /><h2>当前角色无权访问</h2><p>如需使用此模块，请联系系统管理员调整角色权限。</p><Link href="/" className="button"><ArrowLeft size={15} />返回工作台</Link></div>;
}
