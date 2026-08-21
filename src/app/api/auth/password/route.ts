import { NextResponse } from "next/server";
import { changeOwnPassword } from "@/lib/access-control";
import { createWebSession, getCurrentUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const input = await request.json();
    changeOwnPassword(user.id, String(input.currentPassword || ""), String(input.newPassword || ""));
    const response = NextResponse.json({ data: { changed: true } });
    response.cookies.set(SESSION_COOKIE, createWebSession(user.id), sessionCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "密码修改失败" }, { status: 400 });
  }
}
