import { NextResponse } from "next/server";
import { updateSearchTask } from "@/lib/learning";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = await request.json();
    const task = updateSearchTask(id, { status: input.status, claimedBy: input.claimedBy ? String(input.claimedBy) : undefined });
    return task ? NextResponse.json({ data: task }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "任务更新失败" }, { status: 400 });
  }
}
