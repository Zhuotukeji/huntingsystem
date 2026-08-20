import { NextResponse } from "next/server";
import { analyzeScreenshotWithAi } from "@/lib/llm";
import { pluginCorsHeaders, requirePluginSession } from "@/lib/plugin-auth";
import { getCampaign } from "@/lib/repository";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request) {
  try {
    requirePluginSession(request);
    const input = await request.json();
    const campaign = getCampaign(String(input.campaignId || ""));
    if (!campaign) return NextResponse.json({ error: "人才画像不存在" }, { status: 404, headers: pluginCorsHeaders });
    const imageDataUrl = String(input.imageDataUrl || "");
    if (!/^data:image\/(png|jpeg);base64,/.test(imageDataUrl) || imageDataUrl.length > 8_000_000) {
      return NextResponse.json({ error: "截图格式无效或超过 6MB" }, { status: 400, headers: pluginCorsHeaders });
    }
    const data = await analyzeScreenshotWithAi(campaign, imageDataUrl);
    return NextResponse.json({ data }, { headers: { ...pluginCorsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "截图分析失败" }, { status: 400, headers: pluginCorsHeaders });
  }
}
