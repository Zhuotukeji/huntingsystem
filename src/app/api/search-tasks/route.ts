import { NextResponse } from "next/server";
import { listSearchTasks, submitSearchTaskFeedback } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ data: listSearchTasks({ campaignId: params.get("campaignId") || undefined, status: params.get("status") || undefined }) });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    return NextResponse.json({ data: submitSearchTaskFeedback({
      taskId: String(input.taskId || ""),
      resultCount: Number(input.resultCount || 0),
      qualifiedCount: Number(input.qualifiedCount || 0),
      effectiveConversations: Number(input.effectiveConversations || 0),
      note: String(input.note || ""),
      createdBy: String(input.createdBy || "当前用户"),
    }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈保存失败" }, { status: 400 });
  }
}
