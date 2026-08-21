import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  return user ? NextResponse.json({ data: user }) : NextResponse.json({ error: "请先登录" }, { status: 401 });
}
