import { NextResponse } from "next/server";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";
import { listCampaigns } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export function GET(request: Request) {
  try {
    requirePluginSession(request);
    const data = listCampaigns().filter((campaign) => campaign.status === "ACTIVE").map((campaign) => ({ id: campaign.id, name: campaign.name, roleName: campaign.roleName }));
    return NextResponse.json({ data }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "未授权" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
