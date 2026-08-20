import { NextResponse } from "next/server";
import { listSearchTasks } from "@/lib/learning";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function GET(request: Request) {
  try {
    requirePluginSession(request);
    const requested = new URL(request.url).searchParams.get("status")?.split(",").filter(Boolean);
    const allowed = new Set(["NEW", "CLAIMED", "IN_PROGRESS", "DEFERRED"]);
    if (requested?.some((status) => !allowed.has(status))) throw new Error("任务状态筛选无效");
    const statuses = requested?.length ? requested : [...allowed];
    return NextResponse.json({ data: listSearchTasks({ status: statuses, limit: 100 }) }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "任务载入失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
