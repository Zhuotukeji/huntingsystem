import { NextResponse } from "next/server";
import { authenticateUser, createWebSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const email = String(input.email || "").trim();
    const password = String(input.password || "");
    if (!email || !password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
    const user = authenticateUser(email, password);
    if (!user) return NextResponse.json({ error: "邮箱、密码错误或账号已停用" }, { status: 401 });
    const response = NextResponse.json({ data: user });
    response.cookies.set(SESSION_COOKIE, createWebSession(user.id), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 400 });
  }
}
