import { NextResponse } from "next/server";
import { reviewOrganizations, reviewPeople } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const ids = Array.isArray(input.ids) ? input.ids.filter((id: unknown) => typeof id === "string").slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: "请选择记录" }, { status: 400 });
    const count = input.entityType === "organization" ? reviewOrganizations(ids, input.status, input.reason) : input.entityType === "person" ? reviewPeople(ids, input.status, input.reason) : 0;
    return count ? NextResponse.json({ data: { count } }) : NextResponse.json({ error: "实体类型无效" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "批量审核失败" }, { status: 400 });
  }
}
