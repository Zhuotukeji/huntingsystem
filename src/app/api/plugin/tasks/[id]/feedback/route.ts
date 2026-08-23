import { NextResponse } from "next/server";
import { getSearchTask, hasSearchTaskFeedback, submitSearchTaskFeedback } from "@/lib/learning";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = requirePluginSession(request);
    const { id } = await context.params;
    if (hasSearchTaskFeedback(id)) throw new Error("该搜索任务已提交反馈");
    const task = getSearchTask(id);
    if (!task) return NextResponse.json({ error: "搜索任务不存在" }, { status: 404, headers: pluginCorsHeaders });
    if (!new Set(["CLAIMED", "IN_PROGRESS"]).has(task.status)) throw new Error("请先领取并开始任务，再提交反馈");
    const input = await request.json();
    const data = submitSearchTaskFeedback({
      taskId: id,
      resultCount: Number(input.resultCount || 0),
      qualifiedCount: Number(input.qualifiedCount || 0),
      effectiveConversations: Number(input.effectiveConversations || 0),
      note: String(input.note || "").slice(0, 1000),
      createdBy: actor.email,
    });
    return NextResponse.json({ data }, { headers: pluginCorsHeaders });
  } catch (error) {
    const duplicate = error instanceof Error && error.message.includes("已提交反馈");
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈提交失败" }, { status: duplicate ? 409 : pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
