import { KeyRound } from "lucide-react";
import { PasswordForm } from "@/components/password-form";
import { PageIntro } from "@/components/ui";
import { requireAuthenticatedPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireAuthenticatedPage({ allowPasswordChange: true });
  const required = (await searchParams).required === "1" || user.mustChangePassword;
  return <>
    <PageIntro eyebrow="Account Security" title="账号安全" description="更新登录密码并保护账号安全。" />
    <section className="section account-section">
      <div className="section-head"><div><h3><KeyRound size={17} /> 修改密码</h3><p>{user.email}</p></div></div>
      {required ? <div className="password-required">首次登录或密码被重置后，需要先设置新密码。</div> : null}
      <PasswordForm />
    </section>
  </>;
}
