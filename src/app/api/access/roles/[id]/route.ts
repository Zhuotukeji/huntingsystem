import { NextResponse } from "next/server";
import { deleteAccessRole, updateAccessRole } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const input = await request.json();
    const role = updateAccessRole(id, {
      name: String(input.name || ""), description: String(input.description || ""),
      permissionCodes: Array.isArray(input.permissionCodes) ? input.permissionCodes.map(String) : [],
    });
    return NextResponse.json({ data: role });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "角色更新失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("access.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    deleteAccessRole(id);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "角色删除失败" }, { status: 400 });
  }
}
