import { NextResponse } from "next/server";
import { reviewPeople, updateOrganizationStatus } from "@/lib/repository";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const permission = input.entityType === "organization" ? "organizations.manage" : input.entityType === "person" ? "people.manage" : null;
    if (!permission) return NextResponse.json({ error: "实体类型无效" }, { status: 400 });
    const auth = await authorizeApi(permission);
    if ("response" in auth) return auth.response;
    const ids = Array.isArray(input.ids) ? input.ids.filter((id: unknown) => typeof id === "string").slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: "请选择记录" }, { status: 400 });
    const count = input.entityType === "organization" ? updateOrganizationStatus(ids, input.status, input.reason) : reviewPeople(ids, input.status, input.reason, auth.user.name);
    return NextResponse.json({ data: { count } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "批量审核失败" }, { status: 400 });
  }
}
