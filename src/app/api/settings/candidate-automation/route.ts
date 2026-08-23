import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { getCandidateAutomationSettings, saveCandidateAutomationSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApi("settings.view");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ data: getCandidateAutomationSettings() });
}

export async function PUT(request: Request) {
  const auth = await authorizeApi("settings.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    return NextResponse.json({ data: saveCandidateAutomationSettings({ rules: input.rules, searchTaskMinimumScore: input.searchTaskMinimumScore, resumeQualityPolicy: input.resumeQualityPolicy }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "自动推进规则保存失败" }, { status: 400 });
  }
}
