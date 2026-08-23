import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { activateStrategyVersion } from "@/lib/autonomy";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("strategies.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    if (input.status !== "ACTIVE") return NextResponse.json({ error: "只允许显式激活不可变策略版本" }, { status: 400 });
    return NextResponse.json({ data: activateStrategyVersion((await params).id, auth.user.email) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "策略激活失败" }, { status: 400 });
  }
}
