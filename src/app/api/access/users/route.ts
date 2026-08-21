import { NextResponse } from "next/server";
import { createAccessUser } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const user = createAccessUser({
      name: String(input.name || ""), email: String(input.email || ""), password: String(input.password || ""),
      roleIds: Array.isArray(input.roleIds) ? input.roleIds.map(String) : [],
    });
    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "账号创建失败" }, { status: 400 });
  }
}
