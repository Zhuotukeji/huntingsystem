import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { createStrategyVersion, ensureActiveStrategyVersion, listStrategyVersions } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("strategies.view");
  if ("response" in auth) return auth.response;
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: campaignId && !listStrategyVersions(campaignId).length ? [ensureActiveStrategyVersion(campaignId)] : listStrategyVersions(campaignId) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("strategies.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const current = ensureActiveStrategyVersion(String(input.campaignId || ""), auth.user.email);
    const data = createStrategyVersion({ campaignId: current.campaignId, strategy: input.strategy || current.strategy, changeSummary: String(input.changeSummary || "人工创建策略版本"), createdBy: auth.user.email, activate: input.activate === true });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建策略失败" }, { status: 400 });
  }
}
