import { NextResponse } from "next/server";
import { generateGreetingDraft } from "@/lib/llm";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";
import { getCampaign } from "@/lib/repository";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request) {
  try {
    requirePluginSession(request);
    const input = await request.json();
    const campaign = getCampaign(String(input.campaignId || ""));
    if (!campaign) return NextResponse.json({ error: "人才画像不存在" }, { status: 404, headers: pluginCorsHeaders });
    const candidate = {
      alias: String(input.candidate?.alias || ""),
      currentTitle: String(input.candidate?.currentTitle || "").slice(0, 120),
      currentCompany: String(input.candidate?.currentCompany || "").slice(0, 120),
      evidence: Array.isArray(input.candidate?.evidence) ? input.candidate.evidence.map(String).slice(0, 6) : [],
    };
    return NextResponse.json({ data: await generateGreetingDraft(campaign, candidate) }, { headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "招呼语生成失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
