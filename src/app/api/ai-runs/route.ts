import { NextResponse } from "next/server";
import { createAiRun, executeAiRun, listAiRuns } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ data: listAiRuns() });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const run = createAiRun({
      campaignId: input.campaignId ? String(input.campaignId) : undefined,
      runType: input.runType === "REBUILD" ? "REBUILD" : "MANUAL",
      resumeIds: Array.isArray(input.resumeIds) ? input.resumeIds.map(String) : undefined,
      triggeredBy: String(input.triggeredBy || "当前用户"),
    });
    const result = input.queueOnly ? run : await executeAiRun(run.id);
    return NextResponse.json({ data: result }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 学习失败" }, { status: 400 });
  }
}
