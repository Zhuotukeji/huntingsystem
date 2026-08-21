import { NextResponse } from "next/server";
import { updateSearchTask } from "@/lib/learning";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("search_tasks.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const input = await request.json();
    const task = updateSearchTask(id, { status: input.status, claimedBy: auth.user.email });
    return task ? NextResponse.json({ data: task }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "任务更新失败" }, { status: 400 });
  }
}
