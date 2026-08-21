import { NextResponse } from "next/server";
import { listSearchTasks, submitSearchTaskFeedback } from "@/lib/learning";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeApi("search_tasks.view");
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ data: listSearchTasks({ campaignId: params.get("campaignId") || undefined, status: params.get("status") || undefined }) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("search_tasks.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    return NextResponse.json({ data: submitSearchTaskFeedback({
      taskId: String(input.taskId || ""),
      resultCount: Number(input.resultCount || 0),
      qualifiedCount: Number(input.qualifiedCount || 0),
      effectiveConversations: Number(input.effectiveConversations || 0),
      note: String(input.note || ""),
      createdBy: auth.user.name,
    }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈保存失败" }, { status: 400 });
  }
}
