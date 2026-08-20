import { NextResponse } from "next/server";
import { transitionSearchTask } from "@/lib/learning";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";
import type { SearchTaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function PATCH(request: Request, context: RouteContext<"/api/plugin/tasks/[id]">) {
  try {
    const actor = requirePluginSession(request);
    const { id } = await context.params;
    const input = await request.json();
    const allowed = new Set<SearchTaskStatus>(["CLAIMED", "IN_PROGRESS", "DEFERRED"]);
    const status = String(input.status || "") as SearchTaskStatus;
    if (!allowed.has(status)) throw new Error("插件不允许设置该任务状态");
    return NextResponse.json({ data: transitionSearchTask(id, status, actor.email) }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "任务更新失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
