import { NextResponse } from "next/server";
import { extractResumeScreenshotSegmentWithAi } from "@/lib/llm";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession, screenshotSource } from "@/lib/plugin-auth";
import { sanitizeCapturedText, screenshotHash } from "@/lib/resume-capture";
import { getCampaign } from "@/lib/repository";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export async function POST(request: Request) {
  try {
    requirePluginSession(request);
    const input = await request.json();
    if (input.authorizationConfirmed !== true) throw new Error("请确认该简历用于当前招聘的处理依据");
    if (!getCampaign(String(input.campaignId || ""))) return NextResponse.json({ error: "人才画像不存在" }, { status: 404, headers: pluginCorsHeaders });
    const source = screenshotSource(String(input.pageUrl || ""), input.synthetic === true);
    const imageDataUrl = String(input.imageDataUrl || "");
    if (!/^data:image\/(png|jpeg);base64,/.test(imageDataUrl) || imageDataUrl.length > 8_000_000) {
      return NextResponse.json({ error: "截图格式无效或超过 6MB" }, { status: 400, headers: pluginCorsHeaders });
    }
    const analysis = await extractResumeScreenshotSegmentWithAi(imageDataUrl);
    if (!analysis.isResumeDetail) throw new Error("当前截图不像单个候选人的简历详情，请打开详情页后重试");
    const sanitizedText = sanitizeCapturedText(analysis.text);
    if (sanitizedText.length < 10) throw new Error("当前屏可识别的履历内容太少，请调整页面位置或缩放后重试");
    const sequence = Number(input.sequence || 0);
    const candidateName = (sanitizeCapturedText(analysis.candidateName).split("\n")[0] || "").replace(/^(?:姓名|候选人)\s*[：:]?\s*/, "");
    if (sequence === 1 && !candidateName) throw new Error("第一屏未识别到候选人姓名，请回到简历顶部后重试");
    const data = {
      sequence,
      screenshotHash: screenshotHash(imageDataUrl),
      pageUrl: String(input.pageUrl || ""),
      synthetic: source === "SYNTHETIC",
      candidateName,
      headline: (sanitizeCapturedText(analysis.headline).split("\n")[0] || "").replace(/^(?:职位|当前职位)\s*[：:]?\s*/, ""),
      visibleSection: analysis.visibleSection.trim(),
      text: sanitizedText,
      hasMoreBelow: analysis.hasMoreBelow,
      warnings: analysis.warnings,
    };
    if (!Number.isInteger(data.sequence) || data.sequence < 1 || data.sequence > 10) throw new Error("截图序号无效");
    return NextResponse.json({ data }, { headers: { ...pluginCorsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "简历截图识别失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
