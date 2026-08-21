"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail, Search } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) return setError(result.error || "登录失败");
    router.replace(result.data.mustChangePassword ? "/account?required=1" : "/");
    router.refresh();
  }

  return <main className="login-page">
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-brand"><span><Search size={20} strokeWidth={2.4} /></span><div><strong>觅才</strong><small>AI Talent Intelligence</small></div></div>
      <div className="login-heading"><h1 id="login-title">登录工作台</h1><p>使用企业账号继续</p></div>
      <form onSubmit={submit}>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <label className="login-field"><span>邮箱</span><div><Mail size={17} /><input name="email" type="email" autoComplete="username" placeholder="name@company.com" required autoFocus /></div></label>
        <label className="login-field"><span>密码</span><div><LockKeyhole size={17} /><input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required /></div></label>
        <button className="button primary login-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{loading ? "正在登录" : "登录"}</button>
      </form>
      <p className="login-footnote">账号由系统管理员统一创建</p>
    </section>
  </main>;
}
