import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = await request.json();
  const existing = getTask(id);
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const task = input.action === "cancel" ? updateTask(id, "CANCELLED", "任务已由用户取消。") : updateTask(id, "QUEUED", "任务已重新进入队列，等待执行。");
  return NextResponse.json({ data: task });
}
