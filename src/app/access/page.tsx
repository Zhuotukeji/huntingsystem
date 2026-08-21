import { ShieldCheck } from "lucide-react";
import { AccessManager } from "@/components/access-manager";
import { PageIntro } from "@/components/ui";
import { getAccessOverview } from "@/lib/access-control";
import { hasPermission, requirePagePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const user = await requirePagePermission("access.view");
  const overview = getAccessOverview();
  return <>
    <PageIntro eyebrow="Identity & Access" title="人员与权限" description="统一管理登录账号、角色和模块权限。" />
    <div className="compliance-note access-note"><ShieldCheck size={18} /><div><strong>权限实时生效</strong><br />人员角色或角色权限变更后，该人员的现有登录会话会失效，需要重新登录。</div></div>
    <AccessManager initial={overview} canManage={hasPermission(user, "access.manage")} currentUserId={user.id} />
  </>;
}
