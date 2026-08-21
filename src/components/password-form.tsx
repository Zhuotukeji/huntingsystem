"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Save } from "lucide-react";

export function PasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setDone(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("newPassword") !== data.get("confirmPassword")) {
      setLoading(false); setError("两次输入的新密码不一致"); return;
    }
    const response = await fetch("/api/auth/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }) });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) return setError(result.error || "密码修改失败");
    form.reset(); setDone(true); router.refresh();
  }

  return <form className="password-form" onSubmit={submit}>
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    {done ? <div className="form-success"><CheckCircle2 size={16} />密码已更新</div> : null}
    <div className="field"><label>当前密码</label><input name="currentPassword" type="password" autoComplete="current-password" required /></div>
    <div className="field"><label>新密码</label><input name="newPassword" type="password" autoComplete="new-password" minLength={10} required /><small>至少 10 位，同时包含字母和数字</small></div>
    <div className="field"><label>确认新密码</label><input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></div>
    <div className="form-actions"><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{loading ? "正在保存" : "保存新密码"}</button></div>
  </form>;
}
