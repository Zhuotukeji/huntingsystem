import { NextResponse } from "next/server";
import { listSearchTasks } from "@/lib/learning";
import { pluginCorsHeaders, requirePluginSession } from "@/lib/plugin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function GET(request: Request) {
  try {
    requirePluginSession(request);
    return NextResponse.json({ data: listSearchTasks({ status: "NEW", limit: 100 }) }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "未授权" }, { status: 401, headers: pluginCorsHeaders });
  }
}
