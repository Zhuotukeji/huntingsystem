import { NextResponse } from "next/server";
import { extractResumeScreenshotSegmentWithAi } from "@/lib/llm";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession, screenshotSource } from "@/lib/plugin-auth";
import { hasUsableResumeDetailEvidence, sanitizeCapturedText, screenshotHash } from "@/lib/resume-capture";
import { getCampaign } from "@/lib/repository";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

type SegmentDiagnostic = {
  captureMode: string;
  frameWidth: number | null;
  frameHeight: number | null;
  isResumeDetail: boolean;
  hasCandidateName: boolean;
  hasHeadline: boolean;
  extractedTextLength: number;
  visibleSection: string;
};

class SegmentRecognitionError extends Error {
  constructor(message: string, readonly diagnostic: SegmentDiagnostic) {
    super(message);
    this.name = "SegmentRecognitionError";
  }
}

function safeDimension(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 20_000 ? number : null;
}

function segmentDiagnostic(input: Record<string, unknown>, analysis: {
  isResumeDetail: boolean;
  candidateName: string;
  headline: string;
  visibleSection: string;
}, extractedTextLength: number): SegmentDiagnostic {
  const captureMode = String(input.captureMode || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "unknown";
  const visibleSection = sanitizeCapturedText(analysis.visibleSection).replace(/\s+/g, " ").slice(0, 60) || "未识别";
  return {
    captureMode,
    frameWidth: safeDimension(input.frameWidth),
    frameHeight: safeDimension(input.frameHeight),
    isResumeDetail: analysis.isResumeDetail,
    hasCandidateName: Boolean(sanitizeCapturedText(analysis.candidateName)),
    hasHeadline: Boolean(sanitizeCapturedText(analysis.headline)),
    extractedTextLength,
    visibleSection,
  };
}

export async function POST(request: Request) {
  try {
    requirePluginSession(request);
    const input = await request.json() as Record<string, unknown>;
    if (input.authorizationConfirmed !== true) throw new Error("请确认该简历用于当前招聘的处理依据");
    if (!getCampaign(String(input.campaignId || ""))) return NextResponse.json({ error: "人才画像不存在" }, { status: 404, headers: pluginCorsHeaders });
    const source = screenshotSource(String(input.pageUrl || ""), input.synthetic === true);
    const imageDataUrl = String(input.imageDataUrl || "");
    if (!/^data:image\/(png|jpeg);base64,/.test(imageDataUrl) || imageDataUrl.length > 8_000_000) {
      return NextResponse.json({ error: "截图格式无效或超过 6MB" }, { status: 400, headers: pluginCorsHeaders });
    }
    const sequence = Number(input.sequence || 0);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 10) throw new Error("截图序号无效");
    const analysis = await extractResumeScreenshotSegmentWithAi(imageDataUrl);
    const sanitizedText = sanitizeCapturedText(analysis.text);
    const candidateName = (sanitizeCapturedText(analysis.candidateName).split("\n")[0] || "").replace(/^(?:姓名|候选人)\s*[：:]?\s*/, "");
    const headline = (sanitizeCapturedText(analysis.headline).split("\n")[0] || "").replace(/^(?:职位|当前职位)\s*[：:]?\s*/, "");
    const expectedCandidateName = (sanitizeCapturedText(String(input.expectedCandidateName || "")).split("\n")[0] || "").replace(/^(?:姓名|候选人)\s*[：:]?\s*/, "");
    const diagnostic = segmentDiagnostic(input, analysis, sanitizedText.length);
    if (sanitizedText.length < 10) {
      throw new SegmentRecognitionError("当前屏可识别的履历内容太少，请调整页面位置或缩放后重试", diagnostic);
    }
    if (!hasUsableResumeDetailEvidence({
      isResumeDetail: analysis.isResumeDetail,
      sequence,
      candidateName,
      expectedCandidateName,
      headline,
      text: sanitizedText,
    })) {
      throw new SegmentRecognitionError("当前截图未识别到候选人简历主体，请核对插件中的首帧预览，并确认页面顶部显示候选人姓名", diagnostic);
    }
    if (sequence === 1 && !candidateName) {
      throw new SegmentRecognitionError("第一屏未识别到候选人姓名，请回到简历顶部后重试", diagnostic);
    }
    const data = {
      sequence,
      screenshotHash: screenshotHash(imageDataUrl),
      pageUrl: String(input.pageUrl || ""),
      synthetic: source === "SYNTHETIC",
      candidateName,
      headline,
      visibleSection: analysis.visibleSection.trim(),
      text: sanitizedText,
      hasMoreBelow: analysis.hasMoreBelow,
      warnings: analysis.isResumeDetail ? analysis.warnings : ["页面结构判断不确定，已根据主体履历证据继续处理", ...analysis.warnings],
    };
    return NextResponse.json({ data }, { headers: { ...pluginCorsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    const diagnostic = error instanceof SegmentRecognitionError ? error.diagnostic : undefined;
    if (diagnostic) console.warn("[resume-capture] segment rejected", diagnostic);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "简历截图识别失败", ...(diagnostic ? { diagnostic } : {}) },
      { status: pluginErrorStatus(error), headers: pluginCorsHeaders },
    );
  }
}
