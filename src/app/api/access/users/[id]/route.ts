import { NextResponse } from "next/server";
import { updateAccessUser } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const input = await request.json();
    const user = updateAccessUser(id, {
      name: String(input.name || ""), email: String(input.email || ""), status: input.status === "DISABLED" ? "DISABLED" : "ACTIVE",
      roleIds: Array.isArray(input.roleIds) ? input.roleIds.map(String) : [],
    });
    return NextResponse.json({ data: user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "账号更新失败" }, { status: 400 });
  }
}
