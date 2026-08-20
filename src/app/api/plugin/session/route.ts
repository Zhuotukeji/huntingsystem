import { NextResponse } from "next/server";
import { createPluginSession, pluginCorsHeaders } from "@/lib/plugin-auth";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const data = createPluginSession(String(input.email || ""), String(input.accessCode || ""));
    return NextResponse.json({ data }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "插件登录失败" }, { status: 401, headers: pluginCorsHeaders });
  }
}
