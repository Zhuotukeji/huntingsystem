import { NextResponse } from "next/server";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession, screenshotSource } from "@/lib/plugin-auth";
import { finalizeResumeCapture, type CapturedResumeSegment } from "@/lib/resume-capture";
import { getCampaign } from "@/lib/repository";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request) {
  try {
    const actor = requirePluginSession(request);
    const input = await request.json();
    if (input.authorizationConfirmed !== true) throw new Error("请确认该简历用于当前招聘的处理依据");
    const legalBasis = String(input.legalBasis || "").trim();
    if (!legalBasis) throw new Error("请填写来源及处理依据");
    const campaignId = String(input.campaignId || "");
    if (!getCampaign(campaignId)) return NextResponse.json({ error: "人才画像不存在" }, { status: 404, headers: pluginCorsHeaders });
    if (!Array.isArray(input.segments)) throw new Error("没有可合并的截图");
    const segments = input.segments as CapturedResumeSegment[];
    segments.forEach((segment) => screenshotSource(String(segment.pageUrl || ""), segment.synthetic === true));
    const data = await finalizeResumeCapture({
      campaignId,
      legalBasis,
      createdBy: actor.email,
      segments,
      searchTaskId: input.searchTaskId ? String(input.searchTaskId) : null,
      strategyVersionId: input.strategyVersionId ? String(input.strategyVersionId) : null,
      experimentAssignmentId: input.experimentAssignmentId ? String(input.experimentAssignmentId) : null,
    });
    return NextResponse.json({ data }, { status: data.duplicate ? 200 : 201, headers: { ...pluginCorsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "简历入库失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
