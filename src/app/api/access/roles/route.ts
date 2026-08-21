import { NextResponse } from "next/server";
import { createAccessRole } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const role = createAccessRole({
      name: String(input.name || ""), description: String(input.description || ""),
      permissionCodes: Array.isArray(input.permissionCodes) ? input.permissionCodes.map(String) : [],
    });
    return NextResponse.json({ data: role }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "角色创建失败" }, { status: 400 });
  }
}
