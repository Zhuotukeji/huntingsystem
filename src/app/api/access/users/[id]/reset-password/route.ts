import { NextResponse } from "next/server";
import { resetAccessUserPassword } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const input = await request.json();
    resetAccessUserPassword(id, String(input.password || ""));
    return NextResponse.json({ data: { reset: true } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "密码重置失败" }, { status: 400 });
  }
}
